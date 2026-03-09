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

	public function __construct( array $layout ) {
		$this->layout   = $layout;
		$this->build_id = 'fb' . substr( md5( wp_json_encode( $layout ) ), 0, 6 );

		// Override default bp_cfg with saved artboard dimensions if present
		$defs = $layout['_breakpointDefs'] ?? null;
		if ( is_array( $defs ) ) {
			foreach ( [ 'desktop', 'tablet', 'mobile' ] as $bpId ) {
				if ( isset( $defs[ $bpId ] ) ) {
					$this->bp_cfg[ $bpId ] = [
						'max_w'     => (float) ( $defs[ $bpId ]['width']  ?? $this->bp_cfg[ $bpId ]['max_w'] ),
						'default_h' => (float) ( $defs[ $bpId ]['height'] ?? $this->bp_cfg[ $bpId ]['default_h'] ),
					];
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
			foreach ( $root_els as $el ) {
				$html .= $this->render_element( $el, $bpId, $cw, $ch, $artboard_layout_on );
			}
			$html .= '</div>';
			$html .= '</div>';
		}

		$html .= '</div>';
		return $html;
	}

	/** Artboard design dimensions per breakpoint */
	private array $bp_cfg = [
		'desktop' => [ 'max_w' => 1440, 'default_h' => 900  ],
		'tablet'  => [ 'max_w' => 768,  'default_h' => 1024 ],
		'mobile'  => [ 'max_w' => 375,  'default_h' => 812  ],
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
			foreach ( $root_els as $el ) {
				$this->collect_element_css( $el, $bpId, $cw_css, $ch_css, $layout !== null );
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
	private function render_element( array $el, string $bpId, float $cw, float $ch, bool $artboard_layout_on = false ): string {
		$resolved = $this->resolve( $el, $bpId );
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
		$w_str = $width_mode  === 'fill' ? '100%'        : ( $width_mode  === 'hug' ? 'fit-content' : "{$w}px" );
		$h_str = $height_mode === 'fill' ? '100%'        : ( $height_mode === 'hug' ? 'fit-content' : "{$h}px" );
		$pin_right  = !empty( $cx['right'] );
		$pin_bottom = !empty( $cx['bottom'] );
		$right_val  = $cw - $x - $w;
		$bottom_val = $ch - $y - $h;

		if ( $pos_type === 'relative' ) {
			$inline = "position:relative;box-sizing:border-box;width:{$w_str};height:{$h_str};";
		} elseif ( $pos_type === 'fixed' ) {
			$pos_l = $pin_right && empty( $cx['left'] ) ? "right:{$right_val}px" : "left:{$x}px";
			$pos_t = $pin_bottom && empty( $cx['top'] ) ? "bottom:{$bottom_val}px" : "top:{$y}px";
			$inline = "position:fixed;box-sizing:border-box;"
				. "{$pos_l};{$pos_t};width:{$w_str};height:{$h_str};";
		} else {
			$pos_l = $pin_right && empty( $cx['left'] ) ? "right:{$right_val}px" : "left:{$x}px";
			$pos_t = $pin_bottom && empty( $cx['top'] ) ? "bottom:{$bottom_val}px" : "top:{$y}px";
			$inline = "position:absolute;box-sizing:border-box;"
				. "{$pos_l};{$pos_t};width:{$w_str};height:{$h_str};";
		}

		if ( ! empty( $resolved['rotation'] ) ) {
			$inline .= 'transform:rotate(' . floatval( $resolved['rotation'] ) . 'deg);';
		}

		$visual_props = [
			'backgroundColor' => 'background-color',
			'borderRadius'    => 'border-radius',
			'opacity'         => 'opacity',
			'overflow'        => 'overflow',
			'boxShadow'       => 'box-shadow',
		];
		foreach ( $visual_props as $camel => $kebab ) {
			if ( ! isset( $styles[ $camel ] ) || $styles[ $camel ] === '' ) continue;
			$val = $styles[ $camel ];
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

		$html = '<div class="' . esc_attr( $class ) . '" style="' . esc_attr( $inline ) . '">';

		// Image element: render <img> tag filling the div
		if ( ( $el['type'] ?? '' ) === 'image' ) {
			$src       = esc_url( $resolved['src'] ?? '' );
			$obj_fit   = $this->sanitize_css_value( $styles['objectFit'] ?? 'cover' );
			if ( $src ) {
				$img_style = "position:absolute;inset:0;width:100%;height:100%;object-fit:{$obj_fit};border-radius:inherit;";
				$html .= '<img src="' . $src . '" alt="" style="' . esc_attr( $img_style ) . '" loading="lazy">';
			}
		}

		// Background image fill on frames / divs
		$bg_img = $styles['backgroundImage'] ?? '';
		if ( $bg_img !== '' ) {
			$bg_size = $styles['backgroundSize'] ?? 'cover';
			$bg_pos  = esc_attr( $this->sanitize_css_value( $styles['backgroundPosition'] ?? 'center center' ) );
			if ( $bg_size === 'repeat' ) {
				$inline .= 'background-image:url(' . esc_attr( $bg_img ) . ');background-size:auto;background-repeat:repeat;background-position:' . $bg_pos . ';';
			} else {
				$inline .= 'background-image:url(' . esc_attr( $bg_img ) . ');background-size:' . esc_attr( $this->sanitize_css_value( $bg_size ) ) . ';background-repeat:no-repeat;background-position:' . $bg_pos . ';';
			}
			// Re-emit the div with updated inline (background was computed after first assignment)
			$html = '<div class="' . esc_attr( $class ) . '" style="' . esc_attr( $inline ) . '">';
		}

		foreach ( $el['children'] ?? [] as $child_id ) {
			$child = $this->el_index[ $child_id ] ?? null;
			if ( $child ) {
				$html .= $this->render_element( $child, $bpId, $w, $h );
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
	private function collect_element_css( array $el, string $bpId, float $cw, float $ch, bool $artboard_layout_on = false ): void {
		$resolved = $this->resolve( $el, $bpId );
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
			$w_rule = $width_mode  === 'fill' ? 'width: 100%'     : ( $width_mode  === 'hug' ? 'width: fit-content'  : "width: {$w}px" );
			$h_rule = $height_mode === 'fill' ? 'height: 100%'    : ( $height_mode === 'hug' ? 'height: fit-content' : "height: {$h}px" );
			$rules = [
				'position: relative',
				'box-sizing: border-box',
				$w_rule,
				$h_rule,
			];
		} elseif ( $pos_type === 'fixed' || $pos_type === 'absolute' ) {
			$rules = [
				'position: ' . $pos_type,
				'box-sizing: border-box',
			];
			// Horizontal: fill/hug override pinning
			if ( $width_mode === 'fill' ) {
				$rules[] = 'left: 0';
				$rules[] = 'right: 0';
				$rules[] = 'width: auto';
			} elseif ( $width_mode === 'hug' ) {
				$rules[] = "left: {$x}px";
				$rules[] = 'width: fit-content';
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
			// Vertical: fill/hug override pinning
			if ( $height_mode === 'fill' ) {
				$rules[] = 'top: 0';
				$rules[] = 'bottom: 0';
				$rules[] = 'height: auto';
			} elseif ( $height_mode === 'hug' ) {
				$rules[] = "top: {$y}px";
				$rules[] = 'height: fit-content';
			} elseif ( $pin_top && $pin_bottom ) {
				$rules[] = "top: {$y}px";
				$rules[] = "bottom: {$bottom_val}px";
			} elseif ( $pin_bottom && !$pin_top ) {
				$rules[] = "bottom: {$bottom_val}px";
				$rules[] = "height: {$h}px";
			} else {
				$rules[] = "top: {$y}px";
				$rules[] = "height: {$h}px";
			}
		}

		if ( ! empty( $resolved['rotation'] ) ) {
			$rules[] = 'transform: rotate(' . floatval( $resolved['rotation'] ) . 'deg)';
		}

		$allowed_props = [
			'backgroundColor', 'borderRadius', 'borderWidth', 'borderColor', 'borderStyle',
			'opacity', 'overflow', 'display', 'flexDirection', 'flexWrap', 'gap',
			'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
			'alignItems', 'justifyContent', 'boxShadow',
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
		$bg_img = $styles['backgroundImage'] ?? '';
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

		// Recurse: children are % relative to this element's design dimensions.
		foreach ( $el['children'] ?? [] as $child_id ) {
			$child = $this->el_index[ $child_id ] ?? null;
			if ( $child ) {
				$this->collect_element_css( $child, $bpId, $w, $h );
			}
		}
	}

	/**
	 * Show desktop by default; switch to tablet at ≤768px, mobile at ≤375px.
	 * Scoped to this build's ID so multiple published pages don't interfere.
	 */
	private function responsive_visibility_css(): string {
		$bid = $this->build_id;
		return implode( "\n", [
			".{$bid} .fb-bp-tablet, .{$bid} .fb-bp-mobile { display: none; }",
			"@media (max-width: 768px) { .{$bid} .fb-bp-desktop { display: none !important; } .{$bid} .fb-bp-tablet { display: block !important; } }",
			"@media (max-width: 375px) { .{$bid} .fb-bp-tablet  { display: none !important; } .{$bid} .fb-bp-mobile  { display: block !important; } }",
		] );
	}

	// ── Helpers ───────────────────────────────────────────────

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

	private function sanitize_css_value( $value ): string {
		return preg_replace( '/[;\{\}]/', '', (string) $value );
	}
}
