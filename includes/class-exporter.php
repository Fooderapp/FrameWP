<?php
defined( 'ABSPATH' ) || exit;

/**
 * Converts FrameBuilder JSON layout into static HTML + CSS.
 *
 * Data model (new flat model):
 *   page.elements[]  — flat array, each element has:
 *     - base: { x, y, width, height, rotation, locked, hidden, name, styles{} }
 *     - overrides: { tablet: {styles?:{},x?,y?,...}, mobile: {...} }
 *     - parentId: null | string
 *     - children: string[]
 *   page.background: { desktop, tablet, mobile }
 *
 * Three breakpoint containers are rendered; CSS media queries show the right one.
 *
 * RESPONSIVENESS MODEL:
 *   - Each bp container is width:100%, min-height set from design height (px).
 *   - Elements use % for left/top/width/height relative to their containing context.
 *   - Elements use absolute px positioning — no transform:scale, no % scaling.
 */
class FrameBuilder_Exporter {

	private array  $layout;
	private array  $css      = [];
	private string $build_id;
	/** @var array<string, array> id → element map */
	private array  $el_index = [];

	/** @var array<string,array> Cascaded page padding per breakpoint */
	private array  $page_padding = [];

	/** @var array<string,array|null> Cascaded page layout (flex) per breakpoint; null = off */
	private array  $page_layout = [];
	/** @var array<string,array> Component library indexed by component ID */
	private array $component_library = [];
	/** @var array<int,array> Page-scoped variable definitions */
	private array $page_variables = [];
	/** @var array<int,array> Global variable definitions */
	private array $global_variables = [];

	/** @var array<string,float|null> Per-breakpoint viewport fold height (null = auto-compute) */
	private array $viewport_fold_h = [ 'desktop' => null, 'tablet' => null, 'mobile' => null ];

	private function normalize_media_url( $value ): string {
		if ( is_array( $value ) ) {
			if ( isset( $value['url'] ) && is_string( $value['url'] ) ) {
				return trim( $value['url'] );
			}
			return '';
		}
		if ( is_string( $value ) ) {
			return trim( $value );
		}
		return '';
	}

	public function __construct( array $layout ) {
		$this->layout   = $layout;
		$this->build_id = 'fb' . substr( md5( wp_json_encode( $layout ) ), 0, 6 );
		$this->component_library = $this->load_component_library();
		$this->page_variables = $this->normalize_variable_list( $layout['variables'] ?? [], 'page' );
		$this->global_variables = $this->normalize_variable_list(
			json_decode( get_option( '_fb_global_variables', '[]' ), true ),
			'global'
		);

		// Override default bp_cfg with saved artboard dimensions if present
		$defs = $layout['_breakpointDefs'] ?? null;
		if ( is_array( $defs ) ) {
			foreach ( [ 'desktop', 'tablet', 'mobile' ] as $bpId ) {
				if ( isset( $defs[ $bpId ] ) ) {
					$this->bp_cfg[ $bpId ] = [
						'max_w'     => (float) ( $defs[ $bpId ]['width']  ?? $this->bp_cfg[ $bpId ]['max_w'] ),
						'default_h' => (float) ( $defs[ $bpId ]['height'] ?? $this->bp_cfg[ $bpId ]['default_h'] ),
					];
					// Store viewport fold height for correct fixed-element bottom positioning
					if ( isset( $defs[ $bpId ]['viewportFoldH'] ) && $defs[ $bpId ]['viewportFoldH'] !== null ) {
						$this->viewport_fold_h[ $bpId ] = (float) $defs[ $bpId ]['viewportFoldH'];
					}
				}
			}
		}

		// Build index for O(1) child lookups
		foreach ( $layout['elements'] ?? [] as $el ) {
			if ( isset( $el['id'] ) ) {
				$this->el_index[ $el['id'] ] = $el;
			}
		}

		// Cascade page padding: null = inherit from parent breakpoint
		$zero_pad   = [ 'top' => 0, 'right' => 0, 'bottom' => 0, 'left' => 0 ];
		$raw_pad    = $layout['padding'] ?? [];
		$pad_desk   = is_array( $raw_pad['desktop'] ?? null ) ? $raw_pad['desktop'] : $zero_pad;
		$pad_tablet = is_array( $raw_pad['tablet']  ?? null ) ? $raw_pad['tablet']  : null;
		$pad_mobile = is_array( $raw_pad['mobile']  ?? null ) ? $raw_pad['mobile']  : null;
		$this->page_padding = [
			'desktop' => $pad_desk,
			'tablet'  => $pad_tablet ?? $pad_desk,
			'mobile'  => $pad_mobile ?? $pad_tablet ?? $pad_desk,
		];

		// Cascade page layout: null = inherit / disabled
		$raw_layout  = $layout['layout'] ?? [];
		$lay_desk    = is_array( $raw_layout['desktop'] ?? null ) ? $raw_layout['desktop'] : null;
		$lay_tablet  = is_array( $raw_layout['tablet']  ?? null ) ? $raw_layout['tablet']  : null;
		$lay_mobile  = is_array( $raw_layout['mobile']  ?? null ) ? $raw_layout['mobile']  : null;
		$this->page_layout = [
			'desktop' => $lay_desk,
			'tablet'  => $lay_tablet ?? $lay_desk,
			'mobile'  => $lay_mobile ?? $lay_tablet ?? $lay_desk,
		];
	}

	// ── Public API ────────────────────────────────────────────

	/**
	 * Returns the full output: an embedded <style> block followed by the HTML.
	 * Embedding CSS directly means it always renders regardless of theme/enqueue.
	 */
	public function generate_html(): string {
		$css  = $this->generate_css();
		$html = '<style>' . $css . '</style>';

		$bg       = $this->layout['background'] ?? [];
		// Cascade: null = not overridden, inherit from parent breakpoint
		$bg_desktop = $bg['desktop'] ?? '#ffffff';
		$bg_tablet  = $bg['tablet']  ?? null;  // null → inherit desktop
		$bg_mobile  = $bg['mobile']  ?? null;  // null → inherit tablet → desktop
		$cascade_bg = [
			'desktop' => $bg_desktop ?: '#ffffff',
			'tablet'  => $bg_tablet  ?? $bg_desktop ?? '#ffffff',
			'mobile'  => $bg_mobile  ?? $bg_tablet  ?? $bg_desktop ?? '#ffffff',
		];
		$bp_order = [ 'desktop', 'tablet', 'mobile' ];
		$root_els = array_filter(
			$this->layout['elements'] ?? [],
			fn( $e ) => empty( $e['parentId'] )
		);

		$html .= '<div class="fb-page ' . esc_attr( $this->build_id ) . '">';

		foreach ( $bp_order as $bpId ) {
			$cfg      = $this->bp_cfg[ $bpId ] ?? [ 'max_w' => 1440, 'default_h' => 900 ];
			$aw       = (float) $cfg['max_w'];
			$ah       = (float) $this->compute_content_height( $bpId, $cfg['default_h'] );
			$bg_color = esc_attr( $cascade_bg[ $bpId ] ?? '#ffffff' );
			$pad      = $this->page_padding[ $bpId ];
			$cw       = max( 1.0, $aw - $pad['left'] - $pad['right'] );
			$ch       = max( 1.0, $ah - $pad['top']  - $pad['bottom'] );
			$html    .= '<div class="fb-bp fb-bp-' . esc_attr( $bpId ) . '" style="background:' . $bg_color . ';">';
			$html    .= '<div class="fb-bp-inner">';
			$artboard_layout_on = is_array( $this->page_layout[ $bpId ] ?? null );
			$artboard_flex_dir  = $artboard_layout_on ? ( $this->page_layout[ $bpId ]['flexDirection'] ?? 'column' ) : 'none';
			foreach ( $root_els as $el ) {
				$html .= $this->render_element( $el, $bpId, $cw, $ch, $artboard_layout_on, $artboard_flex_dir );
			}
			$html .= '</div>';
			$html .= '</div>';
		}

		$html .= '</div>';
		$html .= $this->get_component_runtime_assets();
		return $html;
	}

	/** Artboard design dimensions per breakpoint */
	private array $bp_cfg = [
		'desktop' => [ 'max_w' => 1440, 'default_h' => 900  ],
		'tablet'  => [ 'max_w' => 768,  'default_h' => 1024 ],
		'mobile'  => [ 'max_w' => 390,  'default_h' => 844  ],
	];

	public function generate_css(): string {
		$this->css = [];
		$bid       = $this->build_id;

		$this->css[] = ".fb-page.{$bid} { width: 100%; }";

		$root_els = array_values( array_filter(
			$this->layout['elements'] ?? [],
			fn( $e ) => empty( $e['parentId'] )
		) );

		foreach ( $this->bp_cfg as $bpId => $cfg ) {
			$aw  = (float) $cfg['max_w'];
			$ah  = (float) $this->compute_content_height( $bpId, $cfg['default_h'] );
			$pad = $this->page_padding[ $bpId ];
			/*
			 * Container fills 100% of the viewport — the artboard IS the page.
			 * Elements keep their designer-pixel positions (px, not %).
			 * Responsiveness = 3 separate layouts switched by media query.
			 */
			$this->css[] = ".{$bid} .fb-bp-{$bpId} { "
				. "width: 100%; "
				. "position: relative; "
				. "min-height: {$ah}px; "
				. "box-sizing: border-box; "
				. "}";
			$cw_css = max( 1.0, $aw - $pad['left'] - $pad['right'] );
			$ch_css = max( 1.0, $ah - $pad['top']  - $pad['bottom'] );
			$layout = $this->page_layout[ $bpId ] ?? null;
			if ( $layout ) {
				$fd  = esc_attr( $layout['flexDirection']  ?? 'column' );
				$ai  = esc_attr( $layout['alignItems']     ?? 'flex-start' );
				$jc  = esc_attr( $layout['justifyContent'] ?? 'flex-start' );
				$fw  = esc_attr( $layout['flexWrap']       ?? 'nowrap' );
				$gap = (float) ( $layout['gap']            ?? 0 );
				$this->css[] = ".{$bid} .fb-bp-{$bpId} .fb-bp-inner { "
					. "position: relative; display: flex; "
					. "flex-direction: {$fd}; align-items: {$ai}; justify-content: {$jc}; flex-wrap: {$fw}; gap: {$gap}px; "
					. "padding: {$pad['top']}px {$pad['right']}px {$pad['bottom']}px {$pad['left']}px; "
					. "}";
			} else {
				$this->css[] = ".{$bid} .fb-bp-{$bpId} .fb-bp-inner { "
					. "position: absolute; "
					. "top: {$pad['top']}px; left: {$pad['left']}px; "
					. "right: {$pad['right']}px; bottom: {$pad['bottom']}px; "
					. "}";
			}
			$artboard_flex_dir_css = $layout !== null ? ( $layout['flexDirection'] ?? 'column' ) : 'none';
			foreach ( $root_els as $el ) {
				$this->collect_element_css( $el, $bpId, $cw_css, $ch_css, $layout !== null, $artboard_flex_dir_css );
			}
		}

		$this->css[] = $this->responsive_visibility_css();

		return implode( "\n", $this->css );
	}

	// ── HTML rendering ────────────────────────────────────────

	/**
	 * Render one element to HTML.
	 * Position values use % matching the CSS class — so inline doesn't override responsive CSS.
	 *
	 * @param float $cw  Design width  of the containing context in px.
	 * @param float $ch  Design height of the containing context in px.
	 */
	private function render_element( array $el, string $bpId, float $cw, float $ch, bool $artboard_layout_on = false, string $parent_flex_dir = 'none' ): string {
		$resolved = $this->resolve_element_with_variables( $el, $bpId );
		if ( ! empty( $resolved['hidden'] ) ) return '';

		$id     = preg_replace( '/[^a-zA-Z0-9_-]/', '', $el['id'] ?? '' );
		$class  = 'fb-el fb-el-' . $id;
		$styles = $resolved['styles'] ?? [];

		$x = floatval( $resolved['x']      ?? 0 );
		$y = floatval( $resolved['y']      ?? 0 );
		$w = floatval( $resolved['width']  ?? 100 );
		$h = floatval( $resolved['height'] ?? 100 );

		$cx       = $resolved['constraints'] ?? [];
		$pos_type = $resolved['positionType'] ?? 'absolute';
		// Auto-layout: root elements flow unless explicitly pinned
		if ( $artboard_layout_on && empty( $resolved['absoluteInLayout'] ) ) {
			$pos_type = 'relative';
		}
		if ( $pos_type !== 'relative' && $pos_type !== 'fixed' && ( $x + $w <= 0 || $x >= $cw || $y + $h <= 0 || $y >= $ch ) ) {
			return '';
		}
		$width_mode  = $resolved['widthMode']  ?? 'fixed';
		$height_mode = $resolved['heightMode'] ?? 'fixed';
		$w_fr  = floatval( $resolved['widthFr']   ?? 1 );
		$h_fr  = floatval( $resolved['heightFr']  ?? 1 );
		$w_pct = floatval( $resolved['widthPct']  ?? $w );
		$h_pct = floatval( $resolved['heightPct'] ?? $h );
		$min_w = isset( $resolved['minW'] ) && $resolved['minW'] !== null ? floatval( $resolved['minW'] ) : null;
		$max_w = isset( $resolved['maxW'] ) && $resolved['maxW'] !== null ? floatval( $resolved['maxW'] ) : null;
		$min_h = isset( $resolved['minH'] ) && $resolved['minH'] !== null ? floatval( $resolved['minH'] ) : null;
		$max_h = isset( $resolved['maxH'] ) && $resolved['maxH'] !== null ? floatval( $resolved['maxH'] ) : null;
		$w_str = $width_mode  === 'fill'     ? '100%'
		       : ( $width_mode  === 'hug'      ? 'fit-content'
		       : ( $width_mode  === 'relative' ? "{$w_pct}%"
		       : "{$w}px" ) );
		$h_str = $height_mode === 'fill'     ? '100%'
		       : ( $height_mode === 'hug'      ? 'fit-content'
		       : ( $height_mode === 'relative' ? "{$h_pct}%"
		       : "{$h}px" ) );
		$pin_right  = !empty( $cx['right'] );
		$pin_bottom = !empty( $cx['bottom'] );
		$right_val  = $cw - $x - $w;
		$bottom_val = $ch - $y - $h;

		if ( $pos_type === 'relative' ) {
			// Direction-aware fill sizing (matches CanvasElement.jsx logic)
			$extra = '';
			if ( $parent_flex_dir === 'row' && $width_mode === 'fill' ) {
				// Main axis (width) grows via flex
				$extra  = "flex:{$w_fr} 1 0%;min-width:0;";
				$extra .= ( $height_mode === 'fill' ) ? 'align-self:stretch;' : "height:{$h_str};";
			} elseif ( $parent_flex_dir === 'column' && $height_mode === 'fill' ) {
				// Main axis (height) grows via flex
				$extra  = "flex:{$h_fr} 1 0%;min-height:0;";
				$extra .= ( $width_mode === 'fill' ) ? 'align-self:stretch;' : "width:{$w_str};";
			} else {
				// Cross-axis fill or no flex parent
				$w_part = ( $width_mode  === 'fill' ) ? 'width:100%;'  : "width:{$w_str};";
				$h_part = ( $height_mode === 'fill' ) ? 'height:100%;' : "height:{$h_str};";
				if ( $parent_flex_dir === 'column' && $width_mode  === 'fill' ) $extra .= 'align-self:stretch;';
				if ( $parent_flex_dir === 'row'    && $height_mode === 'fill' ) $extra .= 'align-self:stretch;';
				$extra .= $w_part . $h_part;
			}
			$inline = "position:relative;box-sizing:border-box;{$extra}";
		} elseif ( $pos_type === 'fixed' || $pos_type === 'absolute' ) {
			$position_css = $pos_type === 'fixed' ? 'fixed' : 'absolute';
			$inline = "position:{$position_css};box-sizing:border-box;";

			if ( $width_mode === 'fill' ) {
				$inline .= 'left:0;right:0;width:auto;';
			} elseif ( $width_mode === 'hug' ) {
				$inline .= "left:{$x}px;width:fit-content;";
			} elseif ( $width_mode === 'relative' ) {
				$inline .= "left:{$x}px;width:{$w_pct}%;";
			} elseif ( ! empty( $cx['left'] ) && $pin_right ) {
				$inline .= "left:{$x}px;right:{$right_val}px;";
			} elseif ( $pin_right && empty( $cx['left'] ) ) {
				$inline .= "right:{$right_val}px;width:{$w}px;";
			} else {
				$inline .= "left:{$x}px;width:{$w}px;";
			}

			$eff_bottom_val = ( $pos_type === 'fixed' )
				? ( $this->get_viewport_fold_h( $bpId ) - $y - $h )
				: $bottom_val;

			if ( $height_mode === 'fill' ) {
				$inline .= 'top:0;bottom:0;height:auto;';
			} elseif ( $height_mode === 'hug' ) {
				$inline .= "top:{$y}px;height:fit-content;";
			} elseif ( $height_mode === 'relative' ) {
				$inline .= "top:{$y}px;height:{$h_pct}%;";
			} elseif ( ! empty( $cx['top'] ) && $pin_bottom ) {
				$inline .= "top:{$y}px;bottom:{$eff_bottom_val}px;";
			} elseif ( $pin_bottom && empty( $cx['top'] ) ) {
				$inline .= "bottom:{$eff_bottom_val}px;height:{$h}px;";
			} else {
				$inline .= "top:{$y}px;height:{$h}px;";
			}
		}
		if ( $min_w !== null && $min_w > 0 ) $inline .= "min-width:{$min_w}px;";
		if ( $max_w !== null && $max_w > 0 ) $inline .= "max-width:{$max_w}px;";
		if ( $min_h !== null && $min_h > 0 ) $inline .= "min-height:{$min_h}px;";
		if ( $max_h !== null && $max_h > 0 ) $inline .= "max-height:{$max_h}px;";

		if ( ! empty( $resolved['rotation'] ) ) {
			$inline .= 'transform:rotate(' . floatval( $resolved['rotation'] ) . 'deg);';
		}

		$layout_inline = $inline;

		$visual_props = [
			'backgroundColor' => 'background-color',
			'borderRadius'    => 'border-radius',
			'opacity'         => 'opacity',
			'overflow'        => 'overflow',
			'boxShadow'       => 'box-shadow',
			'zIndex'          => 'z-index',
		];
		foreach ( $visual_props as $camel => $kebab ) {
			if ( ! isset( $styles[ $camel ] ) || $styles[ $camel ] === '' ) continue;
			$val = $styles[ $camel ];
			// CSS gradient strings go to background-image, not background-color
			if ( $camel === 'backgroundColor' && preg_match( '/gradient\(/', $val ) ) {
				$inline .= 'background-image:' . $this->sanitize_css_value( $val ) . ';';
				continue;
			}
			if ( is_numeric( $val ) && $kebab === 'border-radius' ) $val .= 'px';
			$inline .= $kebab . ':' . $this->sanitize_css_value( $val ) . ';';
		}
		// Independent corner radius overrides the shorthand set above
		if ( ( $styles['borderRadiusMode'] ?? '' ) === 'independent' ) {
			$br = (float) ( $styles['borderRadius'] ?? 0 );
			$tl = (float) ( $styles['borderRadiusTL'] ?? $br );
			$tr = (float) ( $styles['borderRadiusTR'] ?? $br );
			$brc = (float) ( $styles['borderRadiusBR'] ?? $br );
			$bl = (float) ( $styles['borderRadiusBL'] ?? $br );
			$inline .= "border-radius:{$tl}px {$tr}px {$brc}px {$bl}px;";
		}

		// Background image fill on frames / divs
		$bg_img = $this->normalize_media_url( $styles['backgroundImage'] ?? '' );
		if ( $bg_img !== '' ) {
			$bg_size = $styles['backgroundSize'] ?? 'cover';
			$bg_pos  = esc_attr( $this->sanitize_css_value( $styles['backgroundPosition'] ?? 'center center' ) );
			if ( $bg_size === 'repeat' ) {
				$inline .= 'background-image:url(' . esc_attr( $bg_img ) . ');background-size:auto;background-repeat:repeat;background-position:' . $bg_pos . ';';
			} else {
				$inline .= 'background-image:url(' . esc_attr( $bg_img ) . ');background-size:' . esc_attr( $this->sanitize_css_value( $bg_size ) ) . ';background-repeat:no-repeat;background-position:' . $bg_pos . ';';
			}
		}

		$component_instance = is_array( $el['componentInstance'] ?? null ) ? $el['componentInstance'] : null;
		$component_id = sanitize_text_field( $component_instance['componentId'] ?? '' );
		$bindings_json = ! empty( $el['bindings'] ) ? esc_attr( wp_json_encode( $this->normalize_bindings( $el['bindings'] ) ) ) : '';
		$interactions_json = ! empty( $el['interactions'] ) ? esc_attr( wp_json_encode( $el['interactions'] ) ) : '';
		$runtime_attrs = '';
		if ( $bindings_json !== '' ) {
			$runtime_attrs .= ' data-fb-bindings="' . $bindings_json . '"';
		}
		if ( $interactions_json !== '' ) {
			$runtime_attrs .= ' data-fb-interactions="' . $interactions_json . '"';
		}
		if ( $component_id && $this->get_component_definition( $component_id ) ) {
			$html = '<div class="' . esc_attr( $class . ' fb-component-instance' ) . '" style="' . esc_attr( $layout_inline ) . '" data-fb-node-id="' . esc_attr( $id ) . '" data-flip-id="' . esc_attr( $id ) . '" data-fb-component-id="' . esc_attr( $component_id ) . '" data-fb-active-variant="' . esc_attr( sanitize_text_field( $component_instance['variantId'] ?? '' ) ) . '"' . $runtime_attrs . '>';
			$html .= $this->render_component_instance_variants( $el, $resolved, $bpId );
			$html .= '</div>';
			return $html;
		}
		// Emit the div with all accumulated inline styles
		$html = '<div class="' . esc_attr( $class ) . '" style="' . esc_attr( $inline ) . '" data-fb-node-id="' . esc_attr( $id ) . '" data-flip-id="' . esc_attr( $id ) . '"' . $runtime_attrs . '>';

		// Image element: render <img> tag filling the div (added after div opening)
		if ( ( $el['type'] ?? '' ) === 'image' ) {
			$src     = esc_url( $this->normalize_media_url( $resolved['src'] ?? '' ) );
			$obj_fit = $this->sanitize_css_value( $styles['objectFit'] ?? 'cover' );
			if ( $src ) {
				$img_style = "position:absolute;inset:0;width:100%;height:100%;object-fit:{$obj_fit};border-radius:inherit;";
				$html .= '<img src="' . $src . '" alt="" style="' . esc_attr( $img_style ) . '" loading="lazy">';
			}
		}

		if ( ( $el['type'] ?? '' ) === 'text' ) {
			$font_family = trim( (string) ( $styles['fontFamily'] ?? 'Inter' ) );
			$font_stack  = $font_family !== '' ? "'{$font_family}', sans-serif" : 'Inter, sans-serif';
			$font_style  = $this->sanitize_css_value( $styles['fontStyle'] ?? 'normal' );
			$font_weight = intval( $styles['fontWeight'] ?? 400 );
			$font_size   = floatval( $styles['fontSize'] ?? 42 ) . ( $styles['fontSizeUnit'] ?? 'px' );
			$line_height = floatval( $styles['lineHeight'] ?? 1.2 ) . ( $styles['lineHeightUnit'] ?? 'em' );
			$letter_space = floatval( $styles['letterSpacing'] ?? 0 ) . ( $styles['letterSpacingUnit'] ?? 'em' );
			$text_align  = $this->sanitize_css_value( $styles['textAlign'] ?? 'left' );
			$text_decoration = $this->sanitize_css_value( $styles['textDecoration'] ?? 'none' );
			$text_color  = $this->sanitize_css_value( $styles['color'] ?? '#000000' );
			$white_space = ( $width_mode === 'hug' && $height_mode === 'hug' ) ? 'pre' : 'pre-wrap';
			$text_style  = 'width:100%;display:block;overflow:visible;';
			$text_style .= 'font-family:' . $this->sanitize_css_value( $font_stack ) . ';';
			$text_style .= 'font-style:' . $font_style . ';';
			$text_style .= 'font-weight:' . $font_weight . ';';
			$text_style .= 'font-size:' . $this->sanitize_css_value( $font_size ) . ';';
			$text_style .= 'line-height:' . $this->sanitize_css_value( $line_height ) . ';';
			$text_style .= 'letter-spacing:' . $this->sanitize_css_value( $letter_space ) . ';';
			$text_style .= 'text-align:' . $text_align . ';';
			$text_style .= 'text-decoration:' . $text_decoration . ';';
			$text_style .= 'color:' . $text_color . ';';
			$text_style .= 'white-space:' . $white_space . ';';
			$text_style .= 'word-break:break-word;';
			$text_value = nl2br( esc_html( (string) ( $resolved['text'] ?? 'Text' ) ) );
			$html .= '<div class="fb-text-content" data-flip-id="' . esc_attr( $id . '__content' ) . '" style="' . esc_attr( $text_style ) . '">' . $text_value . '</div>';
		}

		// Compute flex direction this element provides to its own children
		$child_flex_dir = 'none';
		if ( ( $styles['display'] ?? '' ) === 'flex' ) {
			$child_flex_dir = $styles['flexDirection'] ?? 'column';
		}
		$child_layout_on = $child_flex_dir !== 'none';
		list( $child_cw, $child_ch ) = $this->compute_child_context_size( $resolved, $cw, $ch, $artboard_layout_on, $parent_flex_dir );
		foreach ( $el['children'] ?? [] as $child_id ) {
			$child = $this->el_index[ $child_id ] ?? null;
			if ( $child ) {
				$html .= $this->render_element( $child, $bpId, $child_cw, $child_ch, $child_layout_on, $child_flex_dir );
			}
		}

		$html .= '</div>';
		return $html;
	}

	// ── CSS generation ────────────────────────────────────────

	/**
	 * Emit CSS for one element (% positioning), recurse into children.
	 *
	 * @param float $cw  Design width  of containing context (artboard or parent) in px.
	 * @param float $ch  Design height of containing context in px.
	 */
	private function collect_element_css( array $el, string $bpId, float $cw, float $ch, bool $artboard_layout_on = false, string $parent_flex_dir = 'none' ): void {
		$resolved = $this->resolve_element_with_variables( $el, $bpId );
		if ( ! empty( $resolved['hidden'] ) ) return;

		$id       = preg_replace( '/[^a-zA-Z0-9_-]/', '', $el['id'] ?? '' );
		$selector = ".{$this->build_id} .fb-bp-{$bpId} .fb-bp-inner .fb-el-{$id}";
		$styles   = $resolved['styles'] ?? [];

		$x = floatval( $resolved['x']      ?? 0 );
		$y = floatval( $resolved['y']      ?? 0 );
		$w = floatval( $resolved['width']  ?? 100 );
		$h = floatval( $resolved['height'] ?? 100 );

		$cx          = $resolved['constraints'] ?? [];
		$pos_type    = $resolved['positionType'] ?? 'absolute';
		// Auto-layout: root elements flow unless explicitly pinned
		if ( $artboard_layout_on && empty( $resolved['absoluteInLayout'] ) ) {
			$pos_type = 'relative';
		}
		$width_mode  = $resolved['widthMode']    ?? 'fixed';
		$height_mode = $resolved['heightMode']   ?? 'fixed';
		$w_fr  = floatval( $resolved['widthFr']   ?? 1 );
		$h_fr  = floatval( $resolved['heightFr']  ?? 1 );
		$w_pct = floatval( $resolved['widthPct']  ?? $w );
		$h_pct = floatval( $resolved['heightPct'] ?? $h );
		$min_w = isset( $resolved['minW'] ) && $resolved['minW'] !== null ? floatval( $resolved['minW'] ) : null;
		$max_w = isset( $resolved['maxW'] ) && $resolved['maxW'] !== null ? floatval( $resolved['maxW'] ) : null;
		$min_h = isset( $resolved['minH'] ) && $resolved['minH'] !== null ? floatval( $resolved['minH'] ) : null;
		$max_h = isset( $resolved['maxH'] ) && $resolved['maxH'] !== null ? floatval( $resolved['maxH'] ) : null;
		$pin_top    = !empty( $cx['top'] );
		$pin_bottom = !empty( $cx['bottom'] );
		$pin_left   = !empty( $cx['left'] );
		$pin_right  = !empty( $cx['right'] );
		// Compute right/bottom from design positions
		$right_val  = $cw - $x - $w;
		$bottom_val = $ch - $y - $h;

		// Off-canvas: skip absolute elements outside artboard; relative/fixed are exempt
		if ( $pos_type !== 'relative' && $pos_type !== 'fixed' && ( $x + $w <= 0 || $x >= $cw || $y + $h <= 0 || $y >= $ch ) ) {
			return;
		}

		if ( $pos_type === 'relative' ) {
			$rules = [ 'position: relative', 'box-sizing: border-box' ];
			if ( $parent_flex_dir === 'row' && $width_mode === 'fill' ) {
				// Main axis: width grows via flex
				$rules[] = "flex: {$w_fr} 1 0%";
				$rules[] = 'min-width: 0';
				if ( $height_mode === 'fill' ) {
					$rules[] = 'align-self: stretch';
				} elseif ( $height_mode === 'hug' ) {
					$rules[] = 'height: fit-content';
				} elseif ( $height_mode === 'relative' ) {
					$rules[] = "height: {$h_pct}%";
				} else {
					$rules[] = "height: {$h}px";
				}
			} elseif ( $parent_flex_dir === 'column' && $height_mode === 'fill' ) {
				// Main axis: height grows via flex
				$rules[] = "flex: {$h_fr} 1 0%";
				$rules[] = 'min-height: 0';
				if ( $width_mode === 'fill' ) {
					$rules[] = 'align-self: stretch';
				} elseif ( $width_mode === 'hug' ) {
					$rules[] = 'width: fit-content';
				} elseif ( $width_mode === 'relative' ) {
					$rules[] = "width: {$w_pct}%";
				} else {
					$rules[] = "width: {$w}px";
				}
			} else {
				// Cross-axis fill or no flex parent
				if ( $width_mode === 'fill' ) {
					if ( $parent_flex_dir === 'column' ) { $rules[] = 'align-self: stretch'; }
					else { $rules[] = 'width: 100%'; }
				} elseif ( $width_mode === 'hug' ) {
					$rules[] = 'width: fit-content';
				} elseif ( $width_mode === 'relative' ) {
					$rules[] = "width: {$w_pct}%";
				} else {
					$rules[] = "width: {$w}px";
				}
				if ( $height_mode === 'fill' ) {
					if ( $parent_flex_dir === 'row' ) { $rules[] = 'align-self: stretch'; }
					else { $rules[] = 'height: 100%'; }
				} elseif ( $height_mode === 'hug' ) {
					$rules[] = 'height: fit-content';
				} elseif ( $height_mode === 'relative' ) {
					$rules[] = "height: {$h_pct}%";
				} else {
					$rules[] = "height: {$h}px";
				}
			}
		} elseif ( $pos_type === 'fixed' || $pos_type === 'absolute' ) {
			$rules = [
				'position: ' . $pos_type,
				'box-sizing: border-box',
			];
			// Horizontal: fill/hug/relative override pinning
			if ( $width_mode === 'fill' ) {
				$rules[] = 'left: 0';
				$rules[] = 'right: 0';
				$rules[] = 'width: auto';
			} elseif ( $width_mode === 'hug' ) {
				$rules[] = "left: {$x}px";
				$rules[] = 'width: fit-content';
			} elseif ( $width_mode === 'relative' ) {
				$rules[] = "left: {$x}px";
				$rules[] = "width: {$w_pct}%";
			} elseif ( $pin_left && $pin_right ) {
				$rules[] = "left: {$x}px";
				$rules[] = "right: {$right_val}px";
			} elseif ( $pin_right && !$pin_left ) {
				$rules[] = "right: {$right_val}px";
				$rules[] = "width: {$w}px";
			} else {
				$rules[] = "left: {$x}px";
				$rules[] = "width: {$w}px";
			}
			// For fixed elements bottom is measured from the viewport fold, not the parent height
			$eff_bottom_val = ( $pos_type === 'fixed' )
				? ( $this->get_viewport_fold_h( $bpId ) - $y - $h )
				: $bottom_val;
			// Vertical: fill/hug/relative override pinning
			if ( $height_mode === 'fill' ) {
				$rules[] = 'top: 0';
				$rules[] = 'bottom: 0';
				$rules[] = 'height: auto';
			} elseif ( $height_mode === 'hug' ) {
				$rules[] = "top: {$y}px";
				$rules[] = 'height: fit-content';
			} elseif ( $height_mode === 'relative' ) {
				$rules[] = "top: {$y}px";
				$rules[] = "height: {$h_pct}%";
			} elseif ( $pin_top && $pin_bottom ) {
				$rules[] = "top: {$y}px";
				$rules[] = "bottom: {$eff_bottom_val}px";
			} elseif ( $pin_bottom && !$pin_top ) {
				$rules[] = "bottom: {$eff_bottom_val}px";
				$rules[] = "height: {$h}px";
			} else {
				$rules[] = "top: {$y}px";
				$rules[] = "height: {$h}px";
			}
		}

		if ( $min_w !== null && $min_w > 0 ) $rules[] = "min-width: {$min_w}px";
		if ( $max_w !== null && $max_w > 0 ) $rules[] = "max-width: {$max_w}px";
		if ( $min_h !== null && $min_h > 0 ) $rules[] = "min-height: {$min_h}px";
		if ( $max_h !== null && $max_h > 0 ) $rules[] = "max-height: {$max_h}px";

		if ( ! empty( $resolved['rotation'] ) ) {
			$rules[] = 'transform: rotate(' . floatval( $resolved['rotation'] ) . 'deg)';
		}

		$allowed_props = [
			'backgroundColor', 'borderRadius', 'borderWidth', 'borderColor', 'borderStyle',
			'opacity', 'overflow', 'display', 'flexDirection', 'flexWrap', 'gap',
			'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
			'alignItems', 'justifyContent', 'boxShadow', 'zIndex',
		];
		$px_props = [
			'border-radius', 'border-width', 'gap',
			'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
		];

		foreach ( $allowed_props as $prop ) {
			if ( ! isset( $styles[ $prop ] ) || $styles[ $prop ] === '' ) continue;
			$val     = $styles[ $prop ];
			$css_key = $this->camel_to_kebab( $prop );
			if ( is_numeric( $val ) && in_array( $css_key, $px_props, true ) ) {
				$val .= 'px';
			}
			$rules[] = $css_key . ': ' . $this->sanitize_css_value( $val );
		}
		// Background image fill
		$bg_img = $this->normalize_media_url( $styles['backgroundImage'] ?? '' );
		if ( $bg_img !== '' ) {
			$bg_size = $styles['backgroundSize'] ?? 'cover';
			$bg_pos  = $styles['backgroundPosition'] ?? 'center center';
			$rules[] = 'background-image: url(' . $this->sanitize_css_value( $bg_img ) . ')';
			if ( $bg_size === 'repeat' ) {
				$rules[] = 'background-size: auto';
				$rules[] = 'background-repeat: repeat';
			} else {
				$rules[] = 'background-size: ' . $this->sanitize_css_value( $bg_size );
				$rules[] = 'background-repeat: no-repeat';
			}
			$rules[] = 'background-position: ' . $this->sanitize_css_value( $bg_pos );
		}
		// Independent corner radius
		if ( ( $styles['borderRadiusMode'] ?? '' ) === 'independent' ) {
			$br = (float) ( $styles['borderRadius'] ?? 0 );
			$tl = (float) ( $styles['borderRadiusTL'] ?? $br );
			$tr = (float) ( $styles['borderRadiusTR'] ?? $br );
			$brc = (float) ( $styles['borderRadiusBR'] ?? $br );
			$bl = (float) ( $styles['borderRadiusBL'] ?? $br );
			$rules = array_filter( $rules, fn( $r ) => strpos( $r, 'border-radius' ) === false );
			$rules[] = "border-radius: {$tl}px {$tr}px {$brc}px {$bl}px";
		}

		$this->css[] = $selector . ' { ' . implode( '; ', $rules ) . ' }';

		// Recurse: pass this element's flex direction to children for fill-mode awareness.
		$child_flex_dir = 'none';
		if ( ( $styles['display'] ?? '' ) === 'flex' ) {
			$child_flex_dir = $styles['flexDirection'] ?? 'column';
		}
		$child_layout_on = $child_flex_dir !== 'none';
		list( $child_cw, $child_ch ) = $this->compute_child_context_size( $resolved, $cw, $ch, $artboard_layout_on, $parent_flex_dir );
		foreach ( $el['children'] ?? [] as $child_id ) {
			$child = $this->el_index[ $child_id ] ?? null;
			if ( $child ) {
				$this->collect_element_css( $child, $bpId, $child_cw, $child_ch, $child_layout_on, $child_flex_dir );
			}
		}
	}

	private function compute_child_context_size( array $resolved, float $cw, float $ch, bool $artboard_layout_on = false, string $parent_flex_dir = 'none' ): array {
		$pos_type = $resolved['positionType'] ?? 'absolute';
		if ( $artboard_layout_on && empty( $resolved['absoluteInLayout'] ) ) {
			$pos_type = 'relative';
		}

		$width_mode = $resolved['widthMode'] ?? 'fixed';
		$height_mode = $resolved['heightMode'] ?? 'fixed';
		$width = max( 1.0, (float) ( $resolved['width'] ?? 1 ) );
		$height = max( 1.0, (float) ( $resolved['height'] ?? 1 ) );
		$width_pct = (float) ( $resolved['widthPct'] ?? $width );
		$height_pct = (float) ( $resolved['heightPct'] ?? $height );

		$effective_width = $width;
		$effective_height = $height;

		if ( 'fill' === $width_mode ) {
			$effective_width = max( 1.0, $cw );
		} elseif ( 'relative' === $width_mode ) {
			$effective_width = max( 1.0, $cw * ( $width_pct / 100 ) );
		}

		if ( 'fill' === $height_mode ) {
			$effective_height = max( 1.0, $ch );
		} elseif ( 'relative' === $height_mode ) {
			$effective_height = max( 1.0, $ch * ( $height_pct / 100 ) );
		}

		if ( 'relative' === $pos_type ) {
			if ( 'row' === $parent_flex_dir && 'fill' === $width_mode && $width > 0 ) {
				$effective_width = $width;
			}
			if ( 'column' === $parent_flex_dir && 'fill' === $height_mode && $height > 0 ) {
				$effective_height = $height;
			}
		}

		return [ $effective_width, $effective_height ];
	}

	/**
	 * Show desktop by default; switch to tablet at ≤768px, mobile at ≤375px.
	 * Scoped to this build's ID so multiple published pages don't interfere.
	 */
	private function responsive_visibility_css(): string {
		$bid = $this->build_id;
		$tablet_max = max( 768, (int) round( (float) ( $this->bp_cfg['tablet']['max_w'] ?? 768 ) ) );
		$mobile_max = max( 480, (int) round( (float) ( $this->bp_cfg['mobile']['max_w'] ?? 390 ) ) );
		return implode( "\n", [
			".{$bid} .fb-bp-tablet, .{$bid} .fb-bp-mobile { display: none; }",
			"@media (max-width: {$tablet_max}px) { .{$bid} .fb-bp-desktop { display: none !important; } .{$bid} .fb-bp-tablet { display: block !important; } }",
			"@media (max-width: {$mobile_max}px) { .{$bid} .fb-bp-tablet  { display: none !important; } .{$bid} .fb-bp-mobile  { display: block !important; } }",
		] );
	}

	// ── Helpers ───────────────────────────────────────────────

	private function normalize_variable_value( string $type, $value ) {
		switch ( $type ) {
			case 'boolean':
				return (bool) $value;
			case 'color':
				return is_string( $value ) && $value !== '' ? $value : '#000000';
			case 'image':
				return $this->normalize_media_url( $value );
			case 'number':
				return is_numeric( $value ) ? (float) $value : 0;
			case 'post':
			case 'product':
				if ( ! is_array( $value ) ) return null;
				return [
					'id'       => isset( $value['id'] ) ? (int) $value['id'] : 0,
					'title'    => isset( $value['title'] ) ? sanitize_text_field( $value['title'] ) : '',
					'url'      => isset( $value['url'] ) ? esc_url_raw( $value['url'] ) : '',
					'postType' => isset( $value['postType'] ) ? sanitize_key( $value['postType'] ) : ( $type === 'product' ? 'product' : 'post' ),
				];
			case 'string':
			default:
				return is_string( $value ) ? $value : (string) ( $value ?? '' );
		}
	}

	private function normalize_variable_list( $variables, string $scope ): array {
		if ( ! is_array( $variables ) ) return [];

		$normalized = [];
		foreach ( $variables as $variable ) {
			if ( ! is_array( $variable ) ) continue;
			$id = isset( $variable['id'] ) ? sanitize_text_field( (string) $variable['id'] ) : '';
			if ( $id === '' ) continue;
			$type = isset( $variable['type'] ) ? sanitize_key( (string) $variable['type'] ) : 'string';
			$normalized[] = [
				'id'         => $id,
				'scope'      => $scope,
				'type'       => $type,
				'name'       => isset( $variable['name'] ) ? sanitize_text_field( $variable['name'] ) : 'Variable',
				'category'   => isset( $variable['category'] ) ? sanitize_text_field( $variable['category'] ) : 'General',
				'persistent' => ! empty( $variable['persistent'] ),
				'value'      => $this->normalize_variable_value( $type, $variable['value'] ?? null ),
			];
		}

		return $normalized;
	}

	private function get_variable_map(): array {
		$page_map = [];
		foreach ( $this->page_variables as $variable ) {
			$page_map[ $variable['id'] ] = $variable;
		}
		$global_map = [];
		foreach ( $this->global_variables as $variable ) {
			$global_map[ $variable['id'] ] = $variable;
		}

		return [
			'page'   => $page_map,
			'global' => $global_map,
		];
	}

	private function normalize_bindings( $bindings ): array {
		$normalized = [ 'desktop' => [], 'tablet' => [], 'mobile' => [] ];
		if ( ! is_array( $bindings ) ) return $normalized;

		foreach ( [ 'desktop', 'tablet', 'mobile' ] as $bp_id ) {
			$bp_bindings = $bindings[ $bp_id ] ?? null;
			if ( ! is_array( $bp_bindings ) ) continue;
			foreach ( $bp_bindings as $property_key => $binding ) {
				if ( ! is_array( $binding ) ) continue;
				$scope = isset( $binding['scope'] ) ? sanitize_key( (string) $binding['scope'] ) : 'page';
				$variable_id = isset( $binding['variableId'] ) ? sanitize_text_field( (string) $binding['variableId'] ) : '';
				if ( $variable_id === '' ) continue;
				$normalized[ $bp_id ][ $property_key ] = [
					'scope'      => $scope === 'global' ? 'global' : 'page',
					'variableId' => $variable_id,
				];
			}
		}

		return $normalized;
	}

	private function resolve_binding( array $bindings, string $bp_id, string $property_key ): ?array {
		if ( $bp_id === 'mobile' ) {
			return $bindings['mobile'][ $property_key ] ?? $bindings['tablet'][ $property_key ] ?? $bindings['desktop'][ $property_key ] ?? null;
		}
		if ( $bp_id === 'tablet' ) {
			return $bindings['tablet'][ $property_key ] ?? $bindings['desktop'][ $property_key ] ?? null;
		}
		return $bindings['desktop'][ $property_key ] ?? null;
	}

	private function apply_variable_binding_value( array $resolved, string $property_key, array $variable ): array {
		$next = $resolved;
		$next['styles'] = is_array( $resolved['styles'] ?? null ) ? $resolved['styles'] : [];
		$value = $variable['value'] ?? null;

		switch ( $property_key ) {
			case 'text':
				$next['text'] = $value === null ? '' : (string) $value;
				break;
			case 'hidden':
				$next['hidden'] = empty( $value );
				break;
			case 'styles.backgroundImage':
				$next['styles']['backgroundImage'] = $this->normalize_media_url( $value );
				break;
			case 'styles.backgroundColor':
				$next['styles']['backgroundColor'] = is_string( $value ) ? $value : '#000000';
				break;
			case 'styles.color':
				$next['styles']['color'] = is_string( $value ) ? $value : '#000000';
				break;
			case 'styles.zIndex':
				$next['styles']['zIndex'] = is_numeric( $value ) ? (float) $value : 0;
				break;
			case 'styles.fontFamily':
				$next['styles']['fontFamily'] = is_string( $value ) ? $value : (string) ( $value ?? '' );
				break;
			case 'src':
				$next['src'] = $this->normalize_media_url( $value );
				break;
		}

		return $next;
	}

	private function resolve_element_with_variables( array $el, string $bp_id ): array {
		$resolved = $this->resolve( $el, $bp_id );
		$bindings = $this->normalize_bindings( $el['bindings'] ?? [] );
		$variable_map = $this->get_variable_map();
		$property_keys = array_values( array_unique( array_merge(
			array_keys( $bindings['desktop'] ?? [] ),
			array_keys( $bindings['tablet'] ?? [] ),
			array_keys( $bindings['mobile'] ?? [] )
		) ) );

		foreach ( $property_keys as $property_key ) {
			$binding = $this->resolve_binding( $bindings, $bp_id, $property_key );
			if ( ! $binding ) continue;
			$scope = $binding['scope'] ?? 'page';
			$variable_id = $binding['variableId'] ?? '';
			$variable = $variable_map[ $scope ][ $variable_id ] ?? null;
			if ( ! is_array( $variable ) ) continue;
			$resolved = $this->apply_variable_binding_value( $resolved, $property_key, $variable );
		}

		return $resolved;
	}

	/**
	 * Merge base + per-breakpoint overrides into a flat resolved array.
	 * Desktop uses base only; tablet/mobile merge base + overrides[bpId].
	 */
	/**
	 * Resolve element props with cascade: desktop (base) → tablet → mobile.
	 * Mobile inherits tablet overrides before applying its own.
	 */
	private function resolve( array $el, string $bpId ): array {
		$base   = $el['base'] ?? [];
		if ( $bpId === 'desktop' ) {
			return $base;
		}
		$tab_ov = $el['overrides']['tablet'] ?? [];
		if ( $bpId === 'tablet' ) {
			return array_merge(
				$base,
				$tab_ov,
				[ 'styles' => array_merge( $base['styles'] ?? [], $tab_ov['styles'] ?? [] ) ]
			);
		}
		// mobile: base → tablet override → mobile override
		$mob_ov = $el['overrides']['mobile'] ?? [];
		return array_merge(
			$base,
			$tab_ov,
			$mob_ov,
			[
				'styles' => array_merge(
					$base['styles'] ?? [],
					$tab_ov['styles'] ?? [],
					$mob_ov['styles'] ?? []
				),
			]
		);
	}

	private function camel_to_kebab( string $str ): string {
		return strtolower( preg_replace( '/([A-Z])/', '-$1', $str ) );
	}

	/**
	 * Return the visible viewport fold height for a breakpoint.
	 * Matches the JS autoFoldH formula: desktop uses 9/16 aspect, others use 16/9.
	 */
	private function get_viewport_fold_h( string $bpId ): float {
		if ( isset( $this->viewport_fold_h[ $bpId ] ) && $this->viewport_fold_h[ $bpId ] !== null ) {
			return $this->viewport_fold_h[ $bpId ];
		}
		$w = (float) ( $this->bp_cfg[ $bpId ]['max_w'] ?? 1440 );
		return $bpId === 'desktop' ? round( $w * 9 / 16 ) : round( $w * 16 / 9 );
	}

	/**
	 * Compute content height by finding the lowest element bottom-edge.
	 * Used to set aspect-ratio on the container so % heights resolve correctly.
	 */
	private function compute_content_height( string $bpId, int $default_h ): int {
		$max_h = $default_h;
		foreach ( $this->layout['elements'] ?? [] as $el ) {
			if ( ! empty( $el['parentId'] ) ) continue;
			$resolved = $this->resolve( $el, $bpId );
			if ( ! empty( $resolved['hidden'] ) ) continue;
			$bottom = intval( $resolved['y'] ?? 0 ) + intval( $resolved['height'] ?? 0 );
			if ( $bottom > $max_h ) {
				$max_h = $bottom;
			}
		}
		return max( $max_h, 100 );
	}

	private function load_component_library(): array {
		$components = is_array( $this->layout['_componentLibrary'] ?? null )
			? $this->layout['_componentLibrary']
			: json_decode( get_option( '_fb_component_library', '[]' ), true );
		if ( ! is_array( $components ) ) return [];

		$indexed = [];
		foreach ( $components as $component ) {
			if ( ! is_array( $component ) || empty( $component['id'] ) ) continue;
			$indexed[ sanitize_text_field( $component['id'] ) ] = $component;
		}

		return $indexed;
	}

	private function get_component_definition( string $component_id ): ?array {
		return $this->component_library[ $component_id ] ?? null;
	}

	private function is_assoc_array( array $value ): bool {
		if ( [] === $value ) return false;
		return array_keys( $value ) !== range( 0, count( $value ) - 1 );
	}

	private function deep_merge_value( $base, $override ) {
		if ( ! is_array( $base ) || ! is_array( $override ) ) return $override;
		if ( ! $this->is_assoc_array( $base ) || ! $this->is_assoc_array( $override ) ) return $override;

		$merged = $base;
		foreach ( $override as $key => $value ) {
			$merged[ $key ] = array_key_exists( $key, $base )
				? $this->deep_merge_value( $base[ $key ], $value )
				: $value;
		}
		return $merged;
	}

	private function get_snapshot_root( array $snapshot ): ?array {
		$id_set = [];
		foreach ( $snapshot as $el ) {
			if ( ! empty( $el['id'] ) ) $id_set[ $el['id'] ] = true;
		}
		foreach ( $snapshot as $el ) {
			$parent_id = $el['parentId'] ?? null;
			if ( ! $parent_id || empty( $id_set[ $parent_id ] ) ) return $el;
		}
		return $snapshot[0] ?? null;
	}

	private function apply_component_variant_overrides( array $primary_snapshot, array $override_snapshot ): array {
		$base_map = [];
		foreach ( $primary_snapshot as $el ) {
			if ( empty( $el['id'] ) ) continue;
			$base_map[ $el['id'] ] = $el;
		}

		$delete_ids = [];
		$collect_delete_ids = function( string $element_id ) use ( &$collect_delete_ids, &$delete_ids, $base_map ): void {
			if ( isset( $delete_ids[ $element_id ] ) ) return;
			$delete_ids[ $element_id ] = true;
			$element = $base_map[ $element_id ] ?? null;
			foreach ( $element['children'] ?? [] as $child_id ) {
				if ( is_string( $child_id ) && $child_id !== '' ) {
					$collect_delete_ids( $child_id );
				}
			}
		};

		foreach ( $override_snapshot as $entry ) {
			if ( ! empty( $entry['__deleted'] ) && ! empty( $entry['id'] ) ) {
				$collect_delete_ids( $entry['id'] );
			}
		}

		$next = [];
		foreach ( $primary_snapshot as $el ) {
			if ( empty( $el['id'] ) || isset( $delete_ids[ $el['id'] ] ) ) continue;
			$clone = $el;
			$clone['children'] = array_values( array_filter(
				$clone['children'] ?? [],
				fn( $child_id ) => ! isset( $delete_ids[ $child_id ] )
			) );
			$next[] = $clone;
		}

		$next_map = [];
		foreach ( $next as $el ) {
			$next_map[ $el['id'] ] = $el;
		}

		foreach ( $override_snapshot as $entry ) {
			if ( ! is_array( $entry ) || ! empty( $entry['__deleted'] ) || empty( $entry['id'] ) ) continue;
			if ( isset( $next_map[ $entry['id'] ] ) ) {
				$merged = $this->deep_merge_value( $next_map[ $entry['id'] ], $entry );
				unset( $merged['__added'], $merged['__deleted'] );
				$next_map[ $entry['id'] ] = $merged;
			} else {
				$added = $entry;
				unset( $added['__added'], $added['__deleted'] );
				$next_map[ $added['id'] ] = $added;
			}
		}

		return array_values( $next_map );
	}

	private function compose_component_variant_snapshot( array $component, ?string $variant_id = null ): array {
		$variants = is_array( $component['variants'] ?? null ) ? $component['variants'] : [];
		if ( empty( $variants ) ) return [];

		$primary_variant = null;
		foreach ( $variants as $candidate ) {
			if ( ! is_array( $candidate ) || empty( $candidate['id'] ) ) continue;
			$mode = sanitize_text_field( $candidate['mode'] ?? 'default' );
			if ( 'default' !== $mode ) continue;
			$primary_variant = $candidate;
			break;
		}
		if ( ! is_array( $primary_variant ) ) return [];

		$target_variant = null;
		foreach ( $variants as $candidate ) {
			if ( ! is_array( $candidate ) || empty( $candidate['id'] ) ) continue;
			if ( $variant_id && $candidate['id'] === $variant_id ) {
				$target_variant = $candidate;
				break;
			}
		}
		if ( ! $target_variant ) {
			$default_variant_id = $component['defaultVariantId'] ?? null;
			foreach ( $variants as $candidate ) {
				if ( ! is_array( $candidate ) || empty( $candidate['id'] ) ) continue;
				if ( $default_variant_id && $candidate['id'] === $default_variant_id ) {
					$target_variant = $candidate;
					break;
				}
			}
		}
		if ( ! $target_variant ) $target_variant = $primary_variant;

		$primary_snapshot = is_array( $primary_variant['snapshot'] ?? null ) ? $primary_variant['snapshot'] : [];
		if ( empty( $target_variant['id'] ) || $target_variant['id'] === ( $primary_variant['id'] ?? null ) ) {
			return $primary_snapshot;
		}

		$target_mode = sanitize_text_field( $target_variant['mode'] ?? 'default' );
		if ( 'default' === $target_mode ) {
			return $this->apply_component_variant_overrides(
				$primary_snapshot,
				is_array( $target_variant['snapshot'] ?? null ) ? $target_variant['snapshot'] : []
			);
		}

		$parent_variant_id = sanitize_text_field( $target_variant['parentVariantId'] ?? '' );
		$parent_snapshot = $parent_variant_id
			? $this->compose_component_variant_snapshot( $component, $parent_variant_id )
			: $primary_snapshot;

		return $this->apply_component_variant_overrides(
			$parent_snapshot,
			is_array( $target_variant['snapshot'] ?? null ) ? $target_variant['snapshot'] : []
		);
	}

	private function prepare_component_variant_snapshot_for_render( array $snapshot ): array {
		return array_map( function( $entry ) {
			if ( ! is_array( $entry ) ) return $entry;
			$next = $entry;
			$base_hidden = ! empty( $next['base']['hidden'] );
			if ( $base_hidden ) {
				$next['base']['hidden'] = false;
				$next['base']['styles'] = is_array( $next['base']['styles'] ?? null ) ? $next['base']['styles'] : [];
				$next['base']['styles']['opacity'] = 0;
			}
			if ( is_array( $next['overrides'] ?? null ) ) {
				foreach ( $next['overrides'] as $bp_key => $override ) {
					if ( ! is_array( $override ) || empty( $override['hidden'] ) ) continue;
					$next['overrides'][ $bp_key ]['hidden'] = false;
					$next['overrides'][ $bp_key ]['styles'] = is_array( $next['overrides'][ $bp_key ]['styles'] ?? null ) ? $next['overrides'][ $bp_key ]['styles'] : [];
					$next['overrides'][ $bp_key ]['styles']['opacity'] = 0;
				}
			}
			return $next;
		}, $snapshot );
	}

	private function render_snapshot_element( array $el, array $snapshot_index, string $bpId, float $cw, float $ch, bool $artboard_layout_on = false, string $parent_flex_dir = 'none' ): string {
		$previous_index = $this->el_index;
		$this->el_index = $snapshot_index;
		$html = $this->render_element( $el, $bpId, $cw, $ch, $artboard_layout_on, $parent_flex_dir );
		$this->el_index = $previous_index;
		return $html;
	}

	private function render_component_instance_variants( array $el, array $resolved, string $bpId ): string {
		$instance = is_array( $el['componentInstance'] ?? null ) ? $el['componentInstance'] : [];
		$component_id = sanitize_text_field( $instance['componentId'] ?? '' );
		$component = $component_id ? $this->get_component_definition( $component_id ) : null;
		$variants = is_array( $component['variants'] ?? null ) ? $component['variants'] : [];
		if ( ! $component || empty( $variants ) ) return '';

		$active_variant_id = sanitize_text_field( $instance['variantId'] ?? ( $component['defaultVariantId'] ?? ( $variants[0]['id'] ?? '' ) ) );
		$root_width = max( 1, (float) ( $resolved['width'] ?? 1 ) );
		$root_height = max( 1, (float) ( $resolved['height'] ?? 1 ) );
		$html = '';

		foreach ( $variants as $variant ) {
			if ( ! is_array( $variant ) || empty( $variant['id'] ) ) continue;
			$variant_id = sanitize_text_field( $variant['id'] );
			$variant_mode = sanitize_text_field( $variant['mode'] ?? 'default' );
			if ( ! in_array( $variant_mode, [ 'default', 'hover', 'pressed' ], true ) ) $variant_mode = 'default';
			$parent_variant_id = sanitize_text_field( $variant['parentVariantId'] ?? '' );
			$snapshot = $this->prepare_component_variant_snapshot_for_render( $this->compose_component_variant_snapshot( $component, $variant_id ) );
			$root = $this->get_snapshot_root( $snapshot );
			if ( ! $root ) continue;

			$snapshot_index = [];
			foreach ( $snapshot as $snapshot_el ) {
				if ( ! empty( $snapshot_el['id'] ) ) $snapshot_index[ $snapshot_el['id'] ] = $snapshot_el;
			}

			$root_variant = $root;
			$root_variant['parentId'] = null;
			$root_variant['base']['x'] = 0;
			$root_variant['base']['y'] = 0;
			$root_variant['base']['width'] = $root_width;
			$root_variant['base']['height'] = $root_height;
			$root_variant['base']['widthMode'] = 'fill';
			$root_variant['base']['heightMode'] = 'fill';
			$root_variant['base']['constraints'] = [
				'top' => true,
				'left' => true,
				'right' => true,
				'bottom' => true,
			];

			$interaction = is_array( $variant['interaction'] ?? null ) ? $variant['interaction'] : null;
			$target_variant_id = sanitize_text_field( $interaction['targetVariantId'] ?? '' );
			$trigger = sanitize_text_field( $interaction['trigger'] ?? '' );
			$delay = isset( $interaction['delay'] ) ? max( 0, (float) $interaction['delay'] ) : 0;
			$transition = $this->normalize_component_transition( is_array( $interaction['transition'] ?? null ) ? $interaction['transition'] : null );
			$attrs = ' data-fb-variant-id="' . esc_attr( $variant_id ) . '"';
			$attrs .= ' data-fb-variant-mode="' . esc_attr( $variant_mode ) . '"';
			$attrs .= ' data-fb-parent-variant-id="' . esc_attr( $parent_variant_id ) . '"';
			$attrs .= ' data-fb-transition-type="' . esc_attr( $transition['type'] ) . '"';
			$attrs .= ' data-fb-transition-duration="' . esc_attr( (string) $transition['duration'] ) . '"';
			$attrs .= ' data-fb-transition-ease="' . esc_attr( $transition['easePreset'] ) . '"';
			$attrs .= ' data-fb-transition-spring-mode="' . esc_attr( $transition['springMode'] ) . '"';
			$attrs .= ' data-fb-transition-bounce="' . esc_attr( (string) $transition['bounce'] ) . '"';
			$attrs .= ' data-fb-transition-stiffness="' . esc_attr( (string) $transition['stiffness'] ) . '"';
			$attrs .= ' data-fb-transition-damping="' . esc_attr( (string) $transition['damping'] ) . '"';
			$attrs .= ' data-fb-transition-mass="' . esc_attr( (string) $transition['mass'] ) . '"';
			$attrs .= ' data-fb-transition-bezier-x1="' . esc_attr( (string) $transition['bezier']['x1'] ) . '"';
			$attrs .= ' data-fb-transition-bezier-y1="' . esc_attr( (string) $transition['bezier']['y1'] ) . '"';
			$attrs .= ' data-fb-transition-bezier-x2="' . esc_attr( (string) $transition['bezier']['x2'] ) . '"';
			$attrs .= ' data-fb-transition-bezier-y2="' . esc_attr( (string) $transition['bezier']['y2'] ) . '"';
			if ( 'default' === $variant_mode && $target_variant_id !== '' && $target_variant_id !== $variant_id ) {
				$attrs .= ' data-fb-trigger="' . esc_attr( $trigger ?: 'click' ) . '"';
				$attrs .= ' data-fb-target-variant-id="' . esc_attr( $target_variant_id ) . '"';
				$attrs .= ' data-fb-delay="' . esc_attr( (string) $delay ) . '"';
			}

			$html .= '<div class="fb-component-variant' . ( $variant_id === $active_variant_id ? ' is-active' : '' ) . '"' . $attrs . '>';
			$html .= $this->render_snapshot_element( $root_variant, $snapshot_index, $bpId, $root_width, $root_height, false, 'none' );
			$html .= '</div>';
		}

		return $html;
	}

	private function normalize_component_transition( ?array $transition ): array {
		$type = sanitize_text_field( $transition['type'] ?? 'instant' );
		if ( ! in_array( $type, [ 'instant', 'ease', 'realistic' ], true ) ) $type = 'instant';
		$ease_preset = sanitize_text_field( $transition['easePreset'] ?? 'easeInOut' );
		if ( ! in_array( $ease_preset, [ 'easeInOut', 'easeOut', 'easeIn', 'linear', 'custom' ], true ) ) $ease_preset = 'easeInOut';
		$spring_mode = sanitize_text_field( $transition['springMode'] ?? 'time' );
		if ( ! in_array( $spring_mode, [ 'time', 'physics' ], true ) ) $spring_mode = 'time';
		$bezier = is_array( $transition['bezier'] ?? null ) ? $transition['bezier'] : [];

		return [
			'type'       => $type,
			'duration'   => isset( $transition['duration'] ) ? max( 0, (float) $transition['duration'] ) : 0.3,
			'easePreset' => $ease_preset,
			'springMode' => $spring_mode,
			'bounce'     => isset( $transition['bounce'] ) ? max( 0, min( 1, (float) $transition['bounce'] ) ) : 0.2,
			'stiffness'  => isset( $transition['stiffness'] ) ? max( 1, (float) $transition['stiffness'] ) : 500,
			'damping'    => isset( $transition['damping'] ) ? max( 1, (float) $transition['damping'] ) : 24,
			'mass'       => isset( $transition['mass'] ) ? max( 0.1, (float) $transition['mass'] ) : 1,
			'bezier'     => [
				'x1' => isset( $bezier['x1'] ) ? max( 0, min( 1, (float) $bezier['x1'] ) ) : 0.44,
				'y1' => isset( $bezier['y1'] ) ? max( 0, min( 1, (float) $bezier['y1'] ) ) : 0,
				'x2' => isset( $bezier['x2'] ) ? max( 0, min( 1, (float) $bezier['x2'] ) ) : 0.56,
				'y2' => isset( $bezier['y2'] ) ? max( 0, min( 1, (float) $bezier['y2'] ) ) : 1,
			],
		];
	}

	private function get_component_runtime_assets(): string {
		$bid = esc_attr( $this->build_id );
		$page_variables_json = wp_json_encode( $this->page_variables );
		$global_variables_json = wp_json_encode( $this->global_variables );
		$css = ".{$bid} .fb-component-instance{position:relative;overflow:hidden;}"
			. ".{$bid} .fb-component-variant{position:absolute;inset:0;visibility:hidden;opacity:0;pointer-events:none;}"
			. ".{$bid} .fb-component-variant.is-active,.{$bid} .fb-component-variant.is-present{visibility:visible;}"
			. ".{$bid} .fb-component-variant.is-active{opacity:1;pointer-events:auto;}"
			. ".{$bid} .fb-component-variant > .fb-el{pointer-events:auto;}";

		$script = <<<'SCRIPT'
<script>
(function(){
	var gsap = window.gsap || null;
	var Flip = window.Flip || (gsap && gsap.plugins ? gsap.plugins.Flip : null) || null;
	if (gsap && Flip && gsap.registerPlugin) gsap.registerPlugin(Flip);
	var scope = document.querySelector('.fb-page.__FB_BUILD_ID__');
	if (!scope) return;
	var embeddedPageVariables = __FB_PAGE_VARIABLES__ || [];
	var embeddedGlobalVariables = __FB_GLOBAL_VARIABLES__ || [];
	var runtimeData = window.fbRuntimeData || {};
	var pageContextId = String(runtimeData.postId || '__FB_BUILD_ID__');
	var cloneValue = function(value) {
		return value == null ? value : JSON.parse(JSON.stringify(value));
	};
	var parseJsonAttr = function(value, fallback) {
		if (!value) return fallback;
		try {
			return JSON.parse(value);
		} catch (error) {
			return fallback;
		}
	};
	var getCurrentBreakpoint = function() {
		var width = window.innerWidth || document.documentElement.clientWidth || 1024;
		if (width <= 375) return 'mobile';
		if (width <= 768) return 'tablet';
		return 'desktop';
	};
	var normalizeVariableValue = function(type, value) {
		if (type === 'boolean') return !!value;
		if (type === 'color') return typeof value === 'string' && value ? value : '#000000';
		if (type === 'image') return typeof value === 'string' ? value : String(value == null ? '' : value);
		if (type === 'number') {
			var parsed = typeof value === 'number' ? value : parseFloat(value);
			return Number.isFinite(parsed) ? parsed : 0;
		}
		if (type === 'post' || type === 'product') {
			if (!value || typeof value !== 'object') return null;
			return {
				id: typeof value.id === 'number' ? value.id : parseInt(value.id, 10) || 0,
				title: typeof value.title === 'string' ? value.title : '',
				url: typeof value.url === 'string' ? value.url : '',
				postType: typeof value.postType === 'string' ? value.postType : (type === 'product' ? 'product' : 'post')
			};
		}
		return typeof value === 'string' ? value : String(value == null ? '' : value);
	};
	var normalizeVariables = function(list, fallbackScope) {
		if (!Array.isArray(list)) return [];
		return list.map(function(variable) {
			if (!variable || typeof variable !== 'object' || !variable.id) return null;
			var type = typeof variable.type === 'string' ? variable.type : 'string';
			var defaultValue = normalizeVariableValue(type, variable.value);
			return {
				id: String(variable.id),
				scope: variable.scope === 'global' ? 'global' : fallbackScope,
				type: type,
				name: typeof variable.name === 'string' ? variable.name : 'Variable',
				category: typeof variable.category === 'string' ? variable.category : 'General',
				persistent: !!variable.persistent,
				defaultValue: defaultValue,
				value: defaultValue
			};
		}).filter(Boolean);
	};
	var pageVariables = normalizeVariables(embeddedPageVariables, 'page');
	var globalVariables = normalizeVariables(
		Array.isArray(runtimeData.globalVariables) && runtimeData.globalVariables.length ? runtimeData.globalVariables : embeddedGlobalVariables,
		'global'
	);
	var variableState = {
		page: new Map(pageVariables.map(function(variable) { return [variable.id, variable]; })),
		global: new Map(globalVariables.map(function(variable) { return [variable.id, variable]; }))
	};
	var getStorageKey = function(scopeName) {
		return scopeName === 'global' ? 'fb:variables:global' : 'fb:variables:page:' + pageContextId;
	};
	var restorePersistentVariables = function(scopeName) {
		var map = variableState[scopeName];
		if (!map || !window.localStorage) return;
		try {
			var raw = window.localStorage.getItem(getStorageKey(scopeName));
			if (!raw) return;
			var saved = JSON.parse(raw);
			if (!saved || typeof saved !== 'object') return;
			map.forEach(function(variable, variableId) {
				if (!variable.persistent || !Object.prototype.hasOwnProperty.call(saved, variableId)) return;
				variable.value = normalizeVariableValue(variable.type, saved[variableId]);
			});
		} catch (error) {
			return;
		}
	};
	var persistVariables = function(scopeName) {
		var map = variableState[scopeName];
		if (!map || !window.localStorage) return;
		var payload = {};
		map.forEach(function(variable, variableId) {
			if (!variable.persistent) return;
			payload[variableId] = variable.value;
		});
		try {
			window.localStorage.setItem(getStorageKey(scopeName), JSON.stringify(payload));
		} catch (error) {
			return;
		}
	};
	var getVariable = function(scopeName, variableId) {
		var map = variableState[scopeName === 'global' ? 'global' : 'page'];
		return map ? (map.get(variableId) || null) : null;
	};
	var setVariableValue = function(scopeName, variableId, nextValue) {
		var variable = getVariable(scopeName, variableId);
		if (!variable) return;
		variable.value = normalizeVariableValue(variable.type, nextValue);
		persistVariables(variable.scope || scopeName);
	};
	var bindingToText = function(value) {
		if (value && typeof value === 'object') {
			if (typeof value.title === 'string' && value.title) return value.title;
			if (typeof value.url === 'string' && value.url) return value.url;
		}
		return value == null ? '' : String(value);
	};
	var resolveBindingForBreakpoint = function(bindings, bpId, propertyKey) {
		if (!bindings || typeof bindings !== 'object') return null;
		var desktop = bindings.desktop || {};
		var tablet = bindings.tablet || {};
		var mobile = bindings.mobile || {};
		if (bpId === 'mobile') return mobile[propertyKey] || tablet[propertyKey] || desktop[propertyKey] || null;
		if (bpId === 'tablet') return tablet[propertyKey] || desktop[propertyKey] || null;
		return desktop[propertyKey] || null;
	};
	var applyBindingToNode = function(node, propertyKey, variable) {
		if (!node || !variable) return;
		var value = variable.value;
		var textNode = node.querySelector('.fb-text-content');
		if (propertyKey === 'text') {
			if (textNode) textNode.textContent = bindingToText(value);
			return;
		}
		if (propertyKey === 'hidden') {
			node.style.display = value ? '' : 'none';
			return;
		}
		if (propertyKey === 'styles.backgroundImage') {
			var backgroundUrl = '';
			if (value && typeof value === 'object' && typeof value.url === 'string') backgroundUrl = value.url;
			else if (typeof value === 'string') backgroundUrl = value;
			backgroundUrl = backgroundUrl.trim();
			node.style.backgroundImage = backgroundUrl ? 'url(' + backgroundUrl.replace(/\)/g, '\\)') + ')' : '';
			return;
		}
		if (propertyKey === 'src') {
			var imageNode = node.tagName === 'IMG' ? node : node.querySelector('img');
			var imageUrl = '';
			if (value && typeof value === 'object' && typeof value.url === 'string') imageUrl = value.url;
			else if (typeof value === 'string') imageUrl = value;
			imageUrl = imageUrl.trim();
			if (imageNode) {
				if (imageUrl) imageNode.setAttribute('src', imageUrl);
				else imageNode.removeAttribute('src');
			}
			return;
		}
		if (propertyKey === 'styles.backgroundColor') {
			node.style.backgroundColor = typeof value === 'string' ? value : '#000000';
			return;
		}
		if (propertyKey === 'styles.color') {
			(textNode || node).style.color = typeof value === 'string' ? value : '#000000';
			return;
		}
		if (propertyKey === 'styles.zIndex') {
			node.style.zIndex = String(typeof value === 'number' ? value : (parseFloat(value) || 0));
			return;
		}
		if (propertyKey === 'styles.fontFamily') {
			(textNode || node).style.fontFamily = bindingToText(value);
		}
	};
	var applyNodeBindings = function(node) {
		var bindings = parseJsonAttr(node.dataset.fbBindings, null);
		if (!bindings) return;
		var bpId = getCurrentBreakpoint();
		var keys = Object.keys(bindings.desktop || {}).concat(Object.keys(bindings.tablet || {}), Object.keys(bindings.mobile || {}))
			.filter(function(propertyKey, index, allKeys) { return allKeys.indexOf(propertyKey) === index; });
		keys.forEach(function(propertyKey) {
			var binding = resolveBindingForBreakpoint(bindings, bpId, propertyKey);
			if (!binding || !binding.variableId) return;
			var variable = getVariable(binding.scope || 'page', binding.variableId);
			if (!variable) return;
			applyBindingToNode(node, propertyKey, variable);
		});
	};
	var applyAllBindings = function() {
		scope.querySelectorAll('[data-fb-bindings]').forEach(applyNodeBindings);
	};
	var executeInteraction = function(interaction) {
		if (!interaction || typeof interaction !== 'object') return;
		if (interaction.type === 'navigate') {
			if (interaction.pageUrl) window.location.href = interaction.pageUrl;
			return;
		}
		if (interaction.type !== 'set-variable' || !interaction.variableId) return;
		var variable = getVariable(interaction.variableScope || 'page', interaction.variableId);
		if (!variable) return;
		var operation = interaction.operation || 'set';
		var nextValue = cloneValue(variable.value);
		if (operation === 'default') {
			nextValue = cloneValue(variable.defaultValue);
		} else if (variable.type === 'boolean') {
			nextValue = operation === 'toggle' ? !variable.value : !!interaction.value;
		} else if (variable.type === 'number') {
			var step = typeof interaction.value === 'number' ? interaction.value : parseFloat(interaction.value);
			step = Number.isFinite(step) ? step : 0;
			if (operation === 'increment') nextValue = (Number(variable.value) || 0) + step;
			else if (operation === 'decrement') nextValue = (Number(variable.value) || 0) - step;
			else nextValue = step;
		} else {
			nextValue = cloneValue(interaction.value);
		}
		setVariableValue(variable.scope || interaction.variableScope || 'page', variable.id, nextValue);
		applyAllBindings();
	};
	var bindInteractions = function(node) {
		if (!node || node.dataset.fbInteractionsBound === '1') return;
		var interactions = parseJsonAttr(node.dataset.fbInteractions, []);
		if (!Array.isArray(interactions) || !interactions.length) return;
		node.dataset.fbInteractionsBound = '1';
		node.style.cursor = 'pointer';
		node.addEventListener('click', function(event) {
			event.stopPropagation();
			interactions.forEach(function(interaction) {
				executeInteraction(interaction);
			});
		});
	};
	restorePersistentVariables('page');
	restorePersistentVariables('global');
	applyAllBindings();
	scope.querySelectorAll('[data-fb-interactions]').forEach(bindInteractions);
	var bindingResizeFrame = null;
	window.addEventListener('resize', function() {
		if (bindingResizeFrame) window.cancelAnimationFrame(bindingResizeFrame);
		bindingResizeFrame = window.requestAnimationFrame(function() {
			applyAllBindings();
		});
	});
	var instances = scope.querySelectorAll('.fb-component-instance[data-fb-component-id]');
	var prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	var EASE_CURVES = {
		easeInOut: 'cubic-bezier(0.44, 0, 0.56, 1)',
		easeOut: 'cubic-bezier(0.22, 1, 0.36, 1)',
		easeIn: 'cubic-bezier(0.64, 0, 0.78, 0)',
		linear: 'linear'
	};
	var findVariant = function(instance, variantId) {
		return Array.prototype.find.call(instance.querySelectorAll('.fb-component-variant'), function(node) {
			return node.dataset.fbVariantId === variantId;
		}) || null;
	};
	var parseNumber = function(value, fallback) {
		var parsed = parseFloat(value);
		return Number.isFinite(parsed) ? parsed : fallback;
	};
	var parseTransition = function(node) {
		return {
			type: node.dataset.fbTransitionType || 'instant',
			duration: Math.max(0, parseNumber(node.dataset.fbTransitionDuration, 0.3)),
			easePreset: node.dataset.fbTransitionEase || 'easeInOut',
			springMode: node.dataset.fbTransitionSpringMode || 'time',
			bounce: Math.max(0, Math.min(1, parseNumber(node.dataset.fbTransitionBounce, 0.2))),
			stiffness: Math.max(1, parseNumber(node.dataset.fbTransitionStiffness, 500)),
			damping: Math.max(1, parseNumber(node.dataset.fbTransitionDamping, 60)),
			mass: Math.max(0.1, parseNumber(node.dataset.fbTransitionMass, 1)),
			bezier: {
				x1: Math.max(0, Math.min(1, parseNumber(node.dataset.fbTransitionBezierX1, 0.44))),
				y1: Math.max(0, Math.min(1, parseNumber(node.dataset.fbTransitionBezierY1, 0))),
				x2: Math.max(0, Math.min(1, parseNumber(node.dataset.fbTransitionBezierX2, 0.56))),
				y2: Math.max(0, Math.min(1, parseNumber(node.dataset.fbTransitionBezierY2, 1)))
			}
		};
	};
	var getEaseValue = function(transition) {
		if (!transition || transition.type === 'instant') return 'linear';
		if (transition.type === 'ease') {
			return createBezierEase(transition.bezier);
		}
		return transition.springMode === 'physics'
			? 'none'
			: 'back.out(' + (1 + transition.bounce * 1.2) + ')';
	};
	var createBezierEase = function(bezier) {
		var x1 = Math.max(0, Math.min(1, bezier && bezier.x1 !== undefined ? bezier.x1 : 0.44));
		var y1 = Math.max(0, Math.min(1, bezier && bezier.y1 !== undefined ? bezier.y1 : 0));
		var x2 = Math.max(0, Math.min(1, bezier && bezier.x2 !== undefined ? bezier.x2 : 0.56));
		var y2 = Math.max(0, Math.min(1, bezier && bezier.y2 !== undefined ? bezier.y2 : 1));
		if (x1 === y1 && x2 === y2) return function(value) { return value; };
		var calcBezier = function(time, point1, point2) {
			var a = 1 - (3 * point2) + (3 * point1);
			var b = (3 * point2) - (6 * point1);
			var c = 3 * point1;
			return (((a * time) + b) * time + c) * time;
		};
		var getSlope = function(time, point1, point2) {
			var a = 1 - (3 * point2) + (3 * point1);
			var b = (3 * point2) - (6 * point1);
			var c = 3 * point1;
			return (3 * a * time * time) + (2 * b * time) + c;
		};
		var binarySubdivide = function(targetX, left, right) {
			var currentX;
			var currentT;
			for (var index = 0; index < 8; index++) {
				currentT = left + ((right - left) * 0.5);
				currentX = calcBezier(currentT, x1, x2) - targetX;
				if (Math.abs(currentX) < 1e-5) return currentT;
				if (currentX > 0) right = currentT;
				else left = currentT;
			}
			return currentT;
		};
		var getTForX = function(targetX) {
			var guessT = targetX;
			for (var index = 0; index < 4; index++) {
				var slope = getSlope(guessT, x1, x2);
				if (Math.abs(slope) < 1e-6) break;
				var currentX = calcBezier(guessT, x1, x2) - targetX;
				guessT -= currentX / slope;
			}
			if (guessT >= 0 && guessT <= 1) return guessT;
			return binarySubdivide(targetX, 0, 1);
		};
		return function(value) {
			return calcBezier(getTForX(Math.max(0, Math.min(1, value))), y1, y2);
		};
	};
	var getPhysicsSpringConfig = function(transition) {
		var mass = Math.max(0.1, transition.mass || 1);
		var stiffness = Math.max(1, transition.stiffness || 500);
		var damping = Math.max(1, transition.damping || 24);
		var angularFrequency = Math.sqrt(stiffness / mass);
		var dampingRatio = damping / (2 * Math.sqrt(stiffness * mass));
		var duration = dampingRatio < 1
			? Math.log(1 / 0.0025) / (Math.max(0.05, dampingRatio) * angularFrequency)
			: Math.log(1 / 0.0025) / angularFrequency;
		return {
			mass: mass,
			stiffness: stiffness,
			damping: damping,
			angularFrequency: angularFrequency,
			dampingRatio: dampingRatio,
			duration: Math.max(0.45, Math.min(2.4, duration))
		};
	};
	var sampleSpringValue = function(initialValue, elapsed, spring) {
		if (!initialValue) return 0;
		var velocity = 0;
		var angularFrequency = spring.angularFrequency;
		var dampingRatio = spring.dampingRatio;
		if (dampingRatio < 1) {
			var dampedFrequency = angularFrequency * Math.sqrt(1 - (dampingRatio * dampingRatio));
			var envelope = Math.exp(-dampingRatio * angularFrequency * elapsed);
			var coefficient = (velocity + (dampingRatio * angularFrequency * initialValue)) / dampedFrequency;
			return envelope * ((initialValue * Math.cos(dampedFrequency * elapsed)) + (coefficient * Math.sin(dampedFrequency * elapsed)));
		}
		if (Math.abs(dampingRatio - 1) < 0.0001) {
			return (initialValue + ((velocity + (angularFrequency * initialValue)) * elapsed)) * Math.exp(-angularFrequency * elapsed);
		}
		var decay = Math.sqrt((dampingRatio * dampingRatio) - 1);
		var rateA = -angularFrequency * (dampingRatio - decay);
		var rateB = -angularFrequency * (dampingRatio + decay);
		var coeffA = (velocity - (rateB * initialValue)) / (rateA - rateB);
		var coeffB = initialValue - coeffA;
		return (coeffA * Math.exp(rateA * elapsed)) + (coeffB * Math.exp(rateB * elapsed));
	};
	var addPhysicsSpringSequence = function(timeline, node, startState, spring, at) {
		var stepCount = 24;
		var previousTime = 0;
		for (var index = 1; index <= stepCount; index++) {
			var elapsed = (spring.duration * index) / stepCount;
			var stepDuration = elapsed - previousTime;
			timeline.to(node, {
				x: sampleSpringValue(startState.x, elapsed, spring),
				y: sampleSpringValue(startState.y, elapsed, spring),
				scaleX: 1 + sampleSpringValue(startState.scaleX - 1, elapsed, spring),
				scaleY: 1 + sampleSpringValue(startState.scaleY - 1, elapsed, spring),
				rotation: sampleSpringValue(startState.rotation || 0, elapsed, spring),
				duration: stepDuration,
				ease: 'none',
				clearProps: index === stepCount ? 'transform' : undefined
			}, at + previousTime);
			previousTime = elapsed;
		}
	};
	var addWrapperPhysicsSequence = function(timeline, node, spring, at) {
		gsap.set(node, { scaleX: 0.935, scaleY: 0.935, transformOrigin: 'top left' });
		addPhysicsSpringSequence(timeline, node, {
			x: 0,
			y: 0,
			scaleX: 0.935,
			scaleY: 0.935
		}, spring, at);
	};
	var getTransitionDurationMs = function(transition) {
		if (!transition || transition.type === 'instant') return 0;
		if (transition.type === 'ease') return Math.max(120, transition.duration * 1000);
		if (transition.springMode === 'time') return Math.max(180, transition.duration * 1000);
		return getPhysicsSpringConfig(transition).duration * 1000;
	};
	var getRealisticOvershoot = function(transition) {
		if (!transition || transition.type !== 'realistic') return 1.03;
		if (transition.springMode === 'physics') {
			var spring = getPhysicsSpringConfig(transition);
			if (spring.dampingRatio >= 1) return 1;
			return 1 + Math.min(0.28, Math.max(0.04, 0.16 * (1 - spring.dampingRatio)));
		}
		return 1 + Math.max(0.06, transition.bounce * 0.18);
	};
	var getRealisticProfile = function(transition) {
		var overshoot = Math.max(0.05, getRealisticOvershoot(transition) - 1);
		return {
			travelOvershoot: Math.max(0.12, overshoot * 1.55),
			scaleOvershoot: Math.max(0.05, overshoot * 1.1),
			pushDuration: Math.max(0.18, transition.duration * 0.42),
			settleDuration: Math.max(0.22, transition.duration * 0.58),
			pushEase: 'power2.out',
			settleEase: 'back.out(' + (1.6 + (transition.bounce * 2.6)) + ')'
		};
	};
	var applyInstantSwitch = function(instance, next) {
		if (gsap) gsap.killTweensOf(instance.querySelectorAll('.fb-component-variant'));
		instance.querySelectorAll('.fb-component-variant').forEach(function(node) {
			node.classList.remove('is-present');
			node.classList.toggle('is-active', node === next);
			node.style.opacity = '';
			node.style.transform = '';
			node.style.visibility = '';
			node.style.pointerEvents = '';
		});
	};
	var getEnterVars = function(transition) {
		if (transition.type === 'realistic') {
			var overshoot = getRealisticOvershoot(transition);
			return {
				opacity: 1,
				y: 0,
				scale: 1,
				duration: getTransitionDurationMs(transition) / 1000,
				ease: transition.springMode === 'physics' ? 'elastic.out(1,' + Math.max(0.2, transition.mass * 0.45) + ')' : 'back.out(' + (1 + transition.bounce * 1.2) + ')',
				clearProps: 'opacity,transform,visibility,pointerEvents',
				transformOrigin: 'top left',
				startAt: { opacity: 0, y: 0, scale: Math.max(0.94, overshoot - 0.06) },
			};
		}
		return {
			opacity: 1,
			y: 0,
			scale: 1,
			duration: getTransitionDurationMs(transition) / 1000,
			ease: getEaseValue(transition),
			clearProps: 'opacity,transform,visibility,pointerEvents',
			transformOrigin: 'top left',
			startAt: { opacity: 0, y: 0, scale: 0.992 },
		};
	};
	var getExitVars = function(transition) {
		return {
			opacity: 0,
			y: 0,
			scale: transition.type === 'realistic' ? 0.985 : 0.992,
			duration: getTransitionDurationMs(transition) / 1000,
			ease: transition.type === 'realistic' ? 'power2.in' : getEaseValue(transition),
			clearProps: 'opacity,transform,visibility,pointerEvents',
			transformOrigin: 'top left',
		};
	};
	var collectSharedElementPairs = function(container, currentVariant, nextVariant) {
		if (!container || !currentVariant || !nextVariant) return [];
		var containerRect = container.getBoundingClientRect();
		var currentNodes = new Map(Array.prototype.map.call(currentVariant.querySelectorAll('[data-fb-node-id]'), function(node) {
			return [node.dataset.fbNodeId, node];
		}));
		return Array.prototype.reduce.call(nextVariant.querySelectorAll('[data-fb-node-id]'), function(pairs, nextNode) {
			var nodeId = nextNode.dataset.fbNodeId;
			var currentNode = currentNodes.get(nodeId);
			if (!nodeId || !currentNode) return pairs;
			var currentRect = currentNode.getBoundingClientRect();
			var nextRect = nextNode.getBoundingClientRect();
			if (!currentRect.width || !currentRect.height || !nextRect.width || !nextRect.height) return pairs;
			var insideViewport = currentRect.right >= containerRect.left
				&& currentRect.left <= containerRect.right
				&& currentRect.bottom >= containerRect.top
				&& currentRect.top <= containerRect.bottom;
			pairs.push({
				currentNode: currentNode,
				nextNode: nextNode,
				deltaX: currentRect.left - nextRect.left,
				deltaY: currentRect.top - nextRect.top,
				scaleX: currentRect.width / nextRect.width,
				scaleY: currentRect.height / nextRect.height,
				insideViewport: insideViewport
			});
			return pairs;
		}, []);
	};
	var ANIMATABLE_STYLE_PROPS = ['backgroundColor', 'color', 'borderRadius', 'borderColor', 'boxShadow', 'opacity'];
	var CROSSFADE_STYLE_PROPS = ['backgroundImage'];
	var FLIP_PROPS = 'opacity,backgroundColor,color,borderRadius,borderColor,boxShadow';
	var hasStyleDifference = function(currentValue, nextValue) {
		if (currentValue === nextValue) return false;
		var currentNumber = parseFloat(currentValue);
		var nextNumber = parseFloat(nextValue);
		if (isFinite(currentNumber) && isFinite(nextNumber)) {
			return Math.abs(currentNumber - nextNumber) > 0.01;
		}
		return true;
	};
	var getRotationFromComputedStyle = function(style) {
		var rotate = style && style.rotate;
		if (rotate && rotate !== 'none') {
			var parsedRotate = parseFloat(rotate);
			if (isFinite(parsedRotate)) return parsedRotate;
		}
		var transform = style && style.transform;
		if (!transform || transform === 'none') return 0;
		var matrixMatch = transform.match(/^matrix\(([^)]+)\)$/);
		if (matrixMatch) {
			var matrixValues = matrixMatch[1].split(',').map(function(value) { return parseFloat(value.trim()); });
			if (matrixValues.length >= 2 && matrixValues.every(function(value) { return isFinite(value); })) {
				return Math.atan2(matrixValues[1], matrixValues[0]) * (180 / Math.PI);
			}
		}
		var matrix3dMatch = transform.match(/^matrix3d\(([^)]+)\)$/);
		if (matrix3dMatch) {
			var matrix3dValues = matrix3dMatch[1].split(',').map(function(value) { return parseFloat(value.trim()); });
			if (matrix3dValues.length >= 2 && matrix3dValues.every(function(value) { return isFinite(value); })) {
				return Math.atan2(matrix3dValues[1], matrix3dValues[0]) * (180 / Math.PI);
			}
		}
		return 0;
	};
	var getNodeAnimationChanges = function(currentNode, nextNode) {
		var currentRect = currentNode.getBoundingClientRect();
		var nextRect = nextNode.getBoundingClientRect();
		var currentStyle = window.getComputedStyle(currentNode);
		var nextStyle = window.getComputedStyle(nextNode);
		var styleFrom = {};
		var styleTo = {};
		ANIMATABLE_STYLE_PROPS.forEach(function(prop) {
			var currentValue = currentStyle[prop];
			var nextValue = nextStyle[prop];
			if (!hasStyleDifference(currentValue, nextValue)) return;
			styleFrom[prop] = currentValue;
			styleTo[prop] = nextValue;
		});
		var unsupportedChange = CROSSFADE_STYLE_PROPS.some(function(prop) {
			return hasStyleDifference(currentStyle[prop], nextStyle[prop]);
		}) || currentNode.textContent !== nextNode.textContent;
		var deltaX = currentRect.left - nextRect.left;
		var deltaY = currentRect.top - nextRect.top;
		var scaleX = currentRect.width / Math.max(nextRect.width, 0.01);
		var scaleY = currentRect.height / Math.max(nextRect.height, 0.01);
		var rotation = getRotationFromComputedStyle(currentStyle) - getRotationFromComputedStyle(nextStyle);
		var geometryChanged = Math.abs(deltaX) > 0.5
			|| Math.abs(deltaY) > 0.5
			|| Math.abs(scaleX - 1) > 0.01
			|| Math.abs(scaleY - 1) > 0.01
			|| Math.abs(rotation) > 0.5;
		return {
			geometryChanged: geometryChanged,
			styleChanged: Object.keys(styleTo).length > 0,
			needsCrossfade: unsupportedChange,
			startState: {
				x: deltaX,
				y: deltaY,
				scaleX: Math.max(0.01, scaleX),
				scaleY: Math.max(0.01, scaleY),
				rotation: rotation
			},
			styleFrom: styleFrom,
			styleTo: styleTo,
			styleProps: Object.keys(styleTo)
		};
	};
	var prepareAnimatedPairs = function(pairs) {
		var pairEntries = pairs.map(function(pair) {
			return { pair: pair, changes: getNodeAnimationChanges(pair.currentNode, pair.nextNode) };
		});
		var byId = new Map(pairEntries.map(function(entry) {
			return [entry.pair.nextNode.dataset.fbNodeId, entry];
		}));
		return pairEntries.filter(function(entry) {
			if (!entry.changes.geometryChanged && !entry.changes.styleChanged && !entry.changes.needsCrossfade) return false;
			var ancestor = entry.pair.nextNode.parentElement ? entry.pair.nextNode.parentElement.closest('[data-fb-node-id]') : null;
			while (ancestor) {
				var ancestorEntry = byId.get(ancestor.dataset.fbNodeId);
				if (ancestorEntry && (ancestorEntry.changes.geometryChanged || ancestorEntry.changes.needsCrossfade)) return false;
				ancestor = ancestor.parentElement ? ancestor.parentElement.closest('[data-fb-node-id]') : null;
			}
			return true;
		});
	};
	var collectTopLevelUnmatchedNodes = function(variantNode, matchedIds) {
		if (!variantNode) return [];
		var allNodes = Array.prototype.slice.call(variantNode.querySelectorAll('[data-fb-node-id]'));
		return allNodes.filter(function(node) {
			var nodeId = node.dataset.fbNodeId;
			if (!nodeId || matchedIds.has(nodeId)) return false;
			var ancestor = node.parentElement ? node.parentElement.closest('[data-fb-node-id]') : null;
			while (ancestor) {
				var ancestorId = ancestor.dataset.fbNodeId;
				if (ancestorId && !matchedIds.has(ancestorId)) return false;
				ancestor = ancestor.parentElement ? ancestor.parentElement.closest('[data-fb-node-id]') : null;
			}
			return true;
		});
	};
	var animateVariantSwitch = function(instance, current, next, transition, onComplete) {
		if (!next) return;
		if (!current || current === next || prefersReducedMotion || !transition || transition.type === 'instant' || !gsap || !Flip) {
			applyInstantSwitch(instance, next);
			if (onComplete) onComplete();
			return;
		}
		var duration = getTransitionDurationMs(transition);
		if (!duration) {
			applyInstantSwitch(instance, next);
			if (onComplete) onComplete();
			return;
		}
		next.classList.add('is-present');
		next.style.visibility = 'visible';
		next.style.pointerEvents = 'none';
		next.style.opacity = '1';
		current.style.pointerEvents = 'none';
		var complete = function() {
			instance.querySelectorAll('.fb-component-variant').forEach(function(node) {
				var isActive = node === next;
				node.classList.remove('is-present');
				node.classList.toggle('is-active', isActive);
				node.style.opacity = '';
				node.style.transform = '';
				node.style.visibility = '';
				node.style.pointerEvents = '';
			});
			if (onComplete) onComplete();
		};
		var currentFlipTargets = current.querySelectorAll('[data-flip-id]');
		var state = Flip.getState(currentFlipTargets, { props: FLIP_PROPS, simple: false });
		var totalDuration = getTransitionDurationMs(transition) / 1000;
		var ease = transition.type === 'realistic'
			? (transition.springMode === 'physics'
				? 'elastic.out(1,' + Math.max(0.2, transition.mass * 0.45) + ')'
				: 'back.out(' + (1 + transition.bounce * 1.2) + ')')
			: getEaseValue(transition);
		current.classList.remove('is-active');
		current.classList.add('is-present');
		next.classList.add('is-present');
		next.classList.add('is-active');
		Flip.from(state, {
			targets: Array.prototype.slice.call(current.querySelectorAll('[data-flip-id]')).concat(Array.prototype.slice.call(next.querySelectorAll('[data-flip-id]'))),
			absolute: true,
			nested: true,
			scale: true,
			simple: false,
			props: FLIP_PROPS,
			duration: totalDuration,
			ease: ease,
			onEnter: function(elements) {
				return gsap.fromTo(elements, { opacity: 0 }, {
					opacity: 1,
					duration: totalDuration,
					ease: ease,
					clearProps: 'opacity'
				});
			},
			onLeave: function(elements) {
				return gsap.to(elements, {
					opacity: 0,
					duration: totalDuration,
					ease: ease,
					clearProps: 'opacity'
				});
			},
			onComplete: complete
		});
	};

	instances.forEach(function(instance) {
		var timer = null;
		var activeVariantId = instance.dataset.fbActiveVariant || '';
		var baseVariantId = '';
		var clearTimer = function() {
			if (!timer) return;
			window.clearTimeout(timer);
			timer = null;
		};
		var isDefaultVariantNode = function(node) {
			return (node && node.dataset ? (node.dataset.fbVariantMode || 'default') : 'default') === 'default';
		};
		var getBaseVariantId = function(variantId) {
			var node = findVariant(instance, variantId);
			if (!node) return baseVariantId || instance.dataset.fbBaseVariant || variantId || '';
			if (isDefaultVariantNode(node)) return node.dataset.fbVariantId || variantId || '';
			return node.dataset.fbParentVariantId || baseVariantId || instance.dataset.fbBaseVariant || variantId || '';
		};
		var getBaseVariantNode = function() {
			var baseId = baseVariantId || instance.dataset.fbBaseVariant || getBaseVariantId(activeVariantId || instance.dataset.fbActiveVariant || '');
			return findVariant(instance, baseId) || getActive();
		};
		var findStateVariant = function(baseVariantId, mode) {
			return Array.prototype.find.call(instance.querySelectorAll('.fb-component-variant'), function(node) {
				return (node.dataset.fbVariantMode || 'default') === mode && (node.dataset.fbParentVariantId || '') === baseVariantId;
			}) || null;
		};
		var getActive = function() {
			return instance.querySelector('.fb-component-variant.is-active') || instance.querySelector('.fb-component-variant');
		};
		var showVariant = function(variantId, transition, options) {
			var current = getActive();
			var next = findVariant(instance, variantId);
			if (!next) return;
			var setBase = options && Object.prototype.hasOwnProperty.call(options, 'setBase')
				? !!options.setBase
				: isDefaultVariantNode(next);
			var queueAfter = options && Object.prototype.hasOwnProperty.call(options, 'queueAppear')
				? !!options.queueAppear
				: setBase;
			var nextBaseVariantId = setBase ? getBaseVariantId(variantId) : (baseVariantId || getBaseVariantId(activeVariantId || instance.dataset.fbActiveVariant || ''));
			animateVariantSwitch(instance, current, next, transition || parseTransition(current || next), function() {
				activeVariantId = variantId;
				baseVariantId = nextBaseVariantId || baseVariantId;
				instance.dataset.fbActiveVariant = activeVariantId;
				instance.dataset.fbBaseVariant = baseVariantId;
				if (queueAfter) queueAppear();
			});
		};
		var applyVisualState = function(mode) {
			var baseId = baseVariantId || instance.dataset.fbBaseVariant || getBaseVariantId(activeVariantId || instance.dataset.fbActiveVariant || '');
			if (!baseId) return;
			var targetNode = mode ? findStateVariant(baseId, mode) : findVariant(instance, baseId);
			var targetId = targetNode ? targetNode.dataset.fbVariantId : baseId;
			if (!targetId || targetId === activeVariantId) return;
			showVariant(targetId, {
				type: 'ease',
				duration: 0.18,
				easePreset: 'easeInOut',
				springMode: 'time',
				bounce: 0,
				stiffness: 500,
				damping: 24,
				mass: 1,
				bezier: { x1: 0.4, y1: 0, x2: 0.2, y2: 1 }
			}, { setBase: false, queueAppear: false });
		};
		var queueAppear = function() {
			clearTimer();
			var active = getBaseVariantNode();
			if (!active || active.dataset.fbTrigger !== 'appear') return;
			var target = active.dataset.fbTargetVariantId;
			if (!target) return;
			var delay = Math.max(0, parseNumber(active.dataset.fbDelay, 0) * 1000);
			var transition = parseTransition(active);
			timer = window.setTimeout(function() {
				showVariant(target, transition);
			}, delay);
		};
		var runTrigger = function(expected) {
			var active = getBaseVariantNode();
			if (!active || active.dataset.fbTrigger !== expected) return;
			var target = active.dataset.fbTargetVariantId;
			if (!target) return;
			var delay = Math.max(0, parseNumber(active.dataset.fbDelay, 0) * 1000);
			var transition = parseTransition(active);
			clearTimer();
			if (delay > 0) {
				timer = window.setTimeout(function() {
					showVariant(target, transition);
				}, delay);
				return;
			}
			showVariant(target, transition);
		};
		instance.addEventListener('click', function(event) {
			event.stopPropagation();
			runTrigger('click');
		});
		instance.addEventListener('pointerdown', function(event) {
			event.stopPropagation();
			applyVisualState('pressed');
			runTrigger('click-start');
		});
		instance.addEventListener('pointerup', function(event) {
			event.stopPropagation();
			if (instance.matches(':hover')) applyVisualState('hover');
			else applyVisualState(null);
		});
		instance.addEventListener('pointercancel', function() { applyVisualState(null); });
		instance.addEventListener('mouseenter', function() {
			applyVisualState('hover');
			runTrigger('mouse-enter');
		});
		instance.addEventListener('mouseleave', function() {
			applyVisualState(null);
			runTrigger('mouse-leave');
		});
		activeVariantId = activeVariantId || (getActive() ? (getActive().dataset.fbVariantId || '') : '');
		baseVariantId = getBaseVariantId(activeVariantId || instance.dataset.fbActiveVariant || '');
		instance.dataset.fbActiveVariant = activeVariantId;
		instance.dataset.fbBaseVariant = baseVariantId;
		queueAppear();
	});
})();
</script>
SCRIPT;

		$script = strtr(
			$script,
			[
				'__FB_BUILD_ID__' => $bid,
				'__FB_PAGE_VARIABLES__' => $page_variables_json,
				'__FB_GLOBAL_VARIABLES__' => $global_variables_json,
			]
		);

		return '<style>' . $css . '</style>' . $script;
	}

	private function sanitize_css_value( $value ): string {
		return preg_replace( '/[;\{\}]/', '', (string) $value );
	}

}
