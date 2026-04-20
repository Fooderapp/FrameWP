<?php
defined( 'ABSPATH' ) || exit;

/**
 * Proxies AI requests from the builder to the configured LLM provider.
 * Keeps the API key server-side.
 */
class FrameBuilder_AI {

	public static function init(): void {
		add_action( 'wp_ajax_framebuilder_ai_chat', [ __CLASS__, 'ajax_ai_chat' ] );
	}

	/**
	 * AJAX handler: proxy prompt → LLM and return structured commands.
	 */
	public static function ajax_ai_chat(): void {
		$raw = file_get_contents( 'php://input' );
		$body = json_decode( $raw, true );
		if ( ! is_array( $body ) ) {
			wp_send_json_error( [ 'message' => 'Invalid request body.' ], 400 );
		}

		// Nonce is sent inside the JSON body; verify manually since
		// check_ajax_referer reads $_REQUEST which is empty for JSON POSTs.
		$nonce = isset( $body['nonce'] ) ? sanitize_text_field( $body['nonce'] ) : '';
		if ( ! wp_verify_nonce( $nonce, 'wp_rest' ) ) {
			wp_send_json_error( [ 'message' => 'Nonce verification failed.' ], 403 );
		}

		if ( ! current_user_can( 'edit_posts' ) ) {
			wp_send_json_error( [ 'message' => 'Permission denied.' ], 403 );
		}

		if ( ! FrameBuilder_Settings::is_ai_enabled() ) {
			wp_send_json_error( [ 'message' => 'AI is not configured. Add your API key in FrameBuilder → Settings.' ], 400 );
		}

		$prompt   = isset( $body['prompt'] ) ? sanitize_textarea_field( $body['prompt'] ) : '';
		$context  = isset( $body['context'] ) && is_array( $body['context'] ) ? $body['context'] : [];
		$history  = isset( $body['history'] ) && is_array( $body['history'] ) ? $body['history'] : [];
		$tiers    = isset( $body['tiers'] ) && is_array( $body['tiers'] ) ? array_map( 'sanitize_text_field', $body['tiers'] ) : [];

		if ( '' === $prompt ) {
			wp_send_json_error( [ 'message' => 'Prompt cannot be empty.' ], 400 );
		}

		$system_prompt = self::build_system_prompt( $context, $tiers );
		$messages      = self::build_messages( $system_prompt, $history, $prompt );

		$provider = FrameBuilder_Settings::get_ai_provider();
		$api_key  = FrameBuilder_Settings::get_ai_api_key();
		$model    = FrameBuilder_Settings::get_ai_model();

		$result = self::call_provider( $provider, $api_key, $model, $messages );

		if ( is_wp_error( $result ) ) {
			wp_send_json_error( [ 'message' => $result->get_error_message() ], 500 );
		}

		wp_send_json_success( $result );
	}

	/**
	 * Build the system prompt that teaches the AI about FrameBuilder elements.
	 */
	private static function build_system_prompt( array $context, array $tiers = [] ): string {
		$has_selection = ! empty( $context['selectedElements'] );

		$prompt = <<<'SYSTEM'
You are FrameBuilder AI, a senior product designer + front-end engineer embedded in a Figma-style visual page builder inside WordPress.

## Response protocol
Return ONLY a JSON object (no prose, no markdown):
{"message":"<≤20 words>","commands":[...]}

## Decision loop (follow in order, think step by step)
1. READ the USER_INTENT + SELECTED section below.
2. If SELECTED is present → the user is editing THOSE elements. Use `updateElement` with their exact `id`. Do NOT create new elements unless the user explicitly says "add", "insert", "new".
3. If SELECTED is empty → you are creating new content at the root.
4. Before emitting, MENTALLY verify: every parentId resolves (real id OR `$N` ref); no root section is missing `widthMode:"fixed"+width:1440+heightMode:"hug"+positionType:"relative"`; every flex container has both `flexDirection` and `alignItems`/`justifyContent`; every text has `fontFamily:"Inter"`.

## Element model (flat array, parent via `parentId`/`children`)

### Core types
TYPES: `frame` (container), `text`, `image`, `icon`.

### Media types
 - `video` — video player. Extra base props: `videoProvider` ("upload"|"youtube"|"vimeo"), `videoUrl` (string), `videoAutoplay` (bool), `videoMuted` (bool), `videoLoop` (bool), `videoControls` (bool). Default 320×180.
 - `embed` — HTML/iframe embed. Extra base props: `embedMode` ("html"|"iframe"), `embedCode` (raw HTML string). Default 360×220.
 - `scroll-sequence` — scroll-triggered video/frame animation. Default 360×240.

### Form types (children must live inside a `form` container)
 - `form` — form container. Styled flex column (gap:14, padding:18). Default 360×280.
 - `text-field` — single-line input. Base props: `placeholder`, `label`, `fieldName`, `required` (bool).
 - `textarea-field` — multi-line textarea. Same props as text-field plus larger height.
 - `dropdown` — select menu. Extra prop: `fieldOptions` (array of {label,value}).
 - `checkbox` — boolean field.
 - `radio-group` — radio options. Extra prop: `fieldOptions`.
 - `file-upload` — file upload dropzone.
 - `submit-button` — form submit button. Base prop: `label` (button text). Default 180×48.

Layout is flexbox: `display:"flex"` + `flexDirection:"row"|"column"`.
Sizing is SEMANTIC — you set MODES, the builder computes pixels:
 - `widthMode:"fill"`   = stretch inside parent flex container (like Figma "fill container")
 - `widthMode:"hug"`    = size to content (like Figma "hug contents")
 - `widthMode:"fixed"`  = exact `width` in px
 (heightMode mirrors this)
Use `fill`/`hug` AGGRESSIVELY. Pixel widths only on fixed-width root sections (1440), images, icons, videos.

## Commands

### addElement
```
{"action":"addElement","type":"frame|text|image|icon|video|embed|form|text-field|textarea-field|dropdown|checkbox|radio-group|file-upload|submit-button","parentId":"<id>|$N|null","props":{…}}
```
`props`:
 • `name`: short descriptive name
 • structural: `x`, `y`, `width`, `height`, `widthMode`, `heightMode`, `positionType` ("relative"|"absolute")
 • `text` (text only), `src` (image/video only)
 • type-specific: `videoProvider`, `videoUrl`, `videoAutoplay`, `videoMuted`, `videoLoop`, `videoControls` (video); `embedMode`, `embedCode` (embed); `placeholder`, `label`, `fieldName`, `required`, `fieldOptions` (form fields)
 • `styles`: visual props — see STYLE_FIELDS below
Reference earlier commands in the SAME batch with `"$0"`, `"$1"`, … (0-based index).

### updateElement  ← DEFAULT for selection edits
```
{"action":"updateElement","elementId":"<id>","baseUpdates":{…},"styleUpdates":{…}}
```
`baseUpdates`: x, y, width, height, text, src, name, widthMode, heightMode, positionType, hidden, videoUrl, videoAutoplay, videoMuted, videoLoop, videoControls, embedCode, placeholder, label, fieldName, required
`styleUpdates`: any key from STYLE_FIELDS
Only include fields that change. Everything else is preserved.

### deleteElement   `{"action":"deleteElement","elementId":"<id>"}`
### reparentElement `{"action":"reparentElement","elementId":"<id>","newParentId":"<id>|null"}`

## STYLE_FIELDS (use these exact keys)
Layout: display, flexDirection, gap, alignItems, justifyContent, flexWrap
Spacing: paddingTop, paddingRight, paddingBottom, paddingLeft
Box: backgroundColor, borderRadius, borderWidth, borderColor, borderStyle, boxShadow, opacity, overflow
Text: color, fontFamily, fontWeight, fontSize, lineHeight, letterSpacing, textAlign
Media: objectFit

## Canonical layout recipes (copy these shapes)

ROOT SECTION (always):
```
{"name":"…","x":0,"y":0,"width":1440,"widthMode":"fixed","heightMode":"hug","positionType":"relative",
 "styles":{"backgroundColor":"…","display":"flex","flexDirection":"column","alignItems":"center","justifyContent":"center","paddingTop":100,"paddingRight":80,"paddingBottom":100,"paddingLeft":80,"gap":32,"overflow":"hidden"}}
```

AUTO-LAYOUT ROW (inside a section):
```
{"widthMode":"fill","heightMode":"hug","styles":{"display":"flex","flexDirection":"row","gap":24,"alignItems":"center","justifyContent":"flex-start"}}
```

CARD (inside a row, fill-width column):
```
{"widthMode":"fill","heightMode":"hug","styles":{"display":"flex","flexDirection":"column","gap":16,"backgroundColor":"#fafafa","borderRadius":16,"paddingTop":32,"paddingRight":28,"paddingBottom":32,"paddingLeft":28,"borderWidth":1,"borderColor":"rgba(0,0,0,0.06)","borderStyle":"solid"}}
```

BUTTON = frame + text child:
```
frame: {"widthMode":"hug","heightMode":"hug","styles":{"display":"flex","flexDirection":"row","alignItems":"center","justifyContent":"center","backgroundColor":"#7c3aed","borderRadius":10,"paddingTop":14,"paddingRight":28,"paddingBottom":14,"paddingLeft":28}}
text:  {"text":"Label","widthMode":"hug","heightMode":"hug","styles":{"fontFamily":"Inter","fontWeight":600,"fontSize":15,"color":"#fff"}}
```

CONTACT FORM (section + form + fields + submit):
```
section: root 1440 fixed, flex column, padding 100/80, gap 48
form container: {"type":"form","widthMode":"fixed","width":560,"styles":{"display":"flex","flexDirection":"column","gap":14,"backgroundColor":"rgba(248,250,252,0.96)","borderRadius":20,"paddingTop":32,"paddingRight":32,"paddingBottom":32,"paddingLeft":32,"borderWidth":1,"borderColor":"rgba(148,163,184,0.42)","borderStyle":"solid"}}
name field:  {"type":"text-field","widthMode":"fill","props":{"placeholder":"Your name","label":"Name","fieldName":"name","required":true}}
email field: {"type":"text-field","widthMode":"fill","props":{"placeholder":"you@email.com","label":"Email","fieldName":"email","required":true}}
message:     {"type":"textarea-field","widthMode":"fill","props":{"placeholder":"How can we help?","label":"Message","fieldName":"message"}}
submit:      {"type":"submit-button","widthMode":"fill","props":{"label":"Send message"}}
```

VIDEO SECTION (section + heading + video):
```
section: root 1440, flex column, gap 48
video: {"type":"video","width":1280,"height":720,"widthMode":"fixed","heightMode":"fixed","styles":{"borderRadius":16,"overflow":"hidden"},"videoUrl":"…","videoControls":true}
```

EMBED SECTION (for maps, third-party widgets):
```
embed: {"type":"embed","width":1280,"height":600,"widthMode":"fixed","styles":{"borderRadius":12,"overflow":"hidden"},"embedMode":"html","embedCode":"<iframe …>"}
```

## Design rules (senior-designer bar)
- Palette: dark bg (#0b0b14 | #141428 | #1a1a2e) + light text (#fff / rgba(255,255,255,0.65)), OR light bg (#fff | #fafafa) + dark text (#0f172a / #64748b). Accent: #7c3aed or #6366f1.
- Typography scale: display 72/800, h1 56/800, h2 44/700, h3 32/700, h4 24/600, subheading 20/500, body 16/400, small 14/400, caption 12/500. fontFamily always "Inter". lineHeight 1.1–1.2 on headings, 1.5–1.6 on body.
- Spacing scale (px): 4, 8, 12, 16, 24, 32, 48, 64, 80, 96, 120. Use these, not arbitrary values.
- Radius: sections 0, cards 12–16, buttons 10, pills 100.
- Images: `https://picsum.photos/seed/{descriptive-slug}/{w}/{h}` (stable per seed).

## Hard rules
1. Selection-first: SELECTED present → updateElement ONLY (unless user says "add/new/insert/duplicate").
2. Root sections: `positionType:"relative"`, `widthMode:"fixed"`, `width:1440`, `heightMode:"hug"`. NEVER set a root y — the executor stacks new sections automatically.
3. Every container with 2+ children MUST set `display:"flex"`, `flexDirection`, and `gap`.
4. Every text element MUST set `fontFamily:"Inter"`.
5. Prefer `widthMode:"fill"` / `"hug"`. Use `"fixed"` only for root sections, images, icons, videos.
6. `$N` references index in current batch ONLY. Existing element edits use real IDs from SELECTED/DETAILED.
7. Output valid JSON. No markdown fences. No keys except `message` and `commands`.
8. If ambiguous → set `message` to a one-line clarifying question, `commands:[]`.
9. Form fields (`text-field`, `textarea-field`, `dropdown`, `checkbox`, `radio-group`, `file-upload`, `submit-button`) MUST be children of a `form` container. Always create the `form` first, then add fields inside it.
10. Video/embed elements: set `videoProvider`, `videoUrl` for video; `embedMode`, `embedCode` for embed. Always include sensible defaults.
SYSTEM;

		// ── Tiered context injection: strip sections the user doesn't need ──
		if ( empty( $tiers ) ) {
			$tiers = [ 'core', 'media', 'forms' ];
		}
		$has_media = in_array( 'media', $tiers, true );
		$has_forms = in_array( 'forms', $tiers, true );

		if ( ! $has_media ) {
			// Strip media types documentation
			$prompt = preg_replace( '/\n\n### Media types\n.*?(?=\n\n### Form types|\n\nLayout is flexbox)/s', '', $prompt );
			// Strip media type names from addElement type list
			$prompt = str_replace( '|video|embed', '', $prompt );
			// Strip video/embed recipes
			$prompt = preg_replace( '/\n\nVIDEO SECTION \(section \+ heading \+ video\):.*?(?=\n\n## Design rules)/s', '', $prompt );
			// Strip media base updates from updateElement
			$prompt = str_replace( ', videoUrl, videoAutoplay, videoMuted, videoLoop, videoControls, embedCode', '', $prompt );
			// Strip hard rule 10
			$prompt = preg_replace( '/\n10\. Video\/embed elements:.*$/m', '', $prompt );
		}

		if ( ! $has_forms ) {
			// Strip form types documentation
			$prompt = preg_replace( '/\n\n### Form types.*?(?=\n\nLayout is flexbox)/s', '', $prompt );
			// Strip form type names from addElement type list
			$prompt = str_replace( '|form|text-field|textarea-field|dropdown|checkbox|radio-group|file-upload|submit-button', '', $prompt );
			// Strip contact form recipe
			$prompt = preg_replace( '/\n\nCONTACT FORM \(section \+ form \+ fields \+ submit\):.*?(?=\n\nVIDEO SECTION|\n\n## Design rules)/s', '', $prompt );
			// Strip form base updates from updateElement
			$prompt = str_replace( ', placeholder, label, fieldName, required', '', $prompt );
			// Strip hard rule 9
			$prompt = preg_replace( '/\n9\. Form fields.*$/m', '', $prompt );
		}

		// Strip/trim type-specific props in addElement based on active tiers
		if ( ! $has_media && ! $has_forms ) {
			$prompt = preg_replace( '/\n • type-specific:.*$/m', '', $prompt );
		} elseif ( ! $has_media ) {
			$prompt = str_replace(
				'`videoProvider`, `videoUrl`, `videoAutoplay`, `videoMuted`, `videoLoop`, `videoControls` (video); `embedMode`, `embedCode` (embed); ',
				'',
				$prompt
			);
		} elseif ( ! $has_forms ) {
			$prompt = str_replace(
				'; `placeholder`, `label`, `fieldName`, `required`, `fieldOptions` (form fields)',
				'',
				$prompt
			);
		}

		// Append task-specific context (compact — no whole-page style dump).
		if ( ! empty( $context['pageTitle'] ) ) {
			$prompt .= "\n\n## Page\n" . sanitize_text_field( $context['pageTitle'] );
		}

		if ( $has_selection ) {
			$sel_json = wp_json_encode( $context['selectedElements'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES );
			$prompt .= "\n\n## SELECTED (active edit target — operate on these)\n" . $sel_json;
			$prompt .= "\n\nThe user's next message is an INSTRUCTION about these elements. Default to `updateElement` with their ids.";
		} else {
			$prompt .= "\n\n## SELECTED\n(none — user is creating new content)";
		}

		if ( ! empty( $context['detailed'] ) && $has_selection ) {
			// Only ship neighborhood detail when editing, so the model understands parent/siblings.
			$detailed_json = wp_json_encode( $context['detailed'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES );
			$prompt .= "\n\n## NEIGHBORHOOD (ancestors + children of selection, for layout context)\n" . $detailed_json;
		}

		if ( ! empty( $context['outline'] ) ) {
			// Compact id/type/name/parentId tree — cheap token cost.
			$outline_json = wp_json_encode( $context['outline'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES );
			$prompt .= "\n\n## PAGE_OUTLINE (id, type, name, parentId — use this to resolve ids)\n" . $outline_json;
		}

		return $prompt;
	}

	/**
	 * Build the messages array for the LLM.
	 */
	private static function build_messages( string $system, array $history, string $prompt ): array {
		$messages = [ [ 'role' => 'system', 'content' => $system ] ];

		// Append conversation history (last 10 exchanges max)
		$history = array_slice( $history, -20 );
		foreach ( $history as $msg ) {
			if ( isset( $msg['role'], $msg['content'] ) && in_array( $msg['role'], [ 'user', 'assistant' ], true ) ) {
				$messages[] = [
					'role'    => sanitize_text_field( $msg['role'] ),
					'content' => sanitize_textarea_field( $msg['content'] ),
				];
			}
		}

		$messages[] = [ 'role' => 'user', 'content' => $prompt ];
		return $messages;
	}

	/**
	 * Route the request to the correct provider.
	 *
	 * @return array|WP_Error  Parsed JSON response from LLM.
	 */
	private static function call_provider( string $provider, string $api_key, string $model, array $messages ) {
		switch ( $provider ) {
			case 'openai':
				return self::call_openai( $api_key, $model, $messages );
			case 'anthropic':
				return self::call_anthropic( $api_key, $model, $messages );
			case 'gemini':
			default:
				return self::call_gemini( $api_key, $model, $messages );
		}
	}

	// ── Gemini ────────────────────────────────────────────────

	private static function call_gemini( string $api_key, string $model, array $messages ) {
		$url = 'https://generativelanguage.googleapis.com/v1beta/models/' . urlencode( $model ) . ':generateContent?key=' . urlencode( $api_key );

		// Convert messages to Gemini format
		$system_instruction = '';
		$contents = [];
		foreach ( $messages as $msg ) {
			if ( 'system' === $msg['role'] ) {
				$system_instruction = $msg['content'];
				continue;
			}
			$contents[] = [
				'role'  => 'assistant' === $msg['role'] ? 'model' : 'user',
				'parts' => [ [ 'text' => $msg['content'] ] ],
			];
		}

		$payload = [
			'contents'          => $contents,
			'generationConfig'  => [
				'responseMimeType' => 'application/json',
				'temperature'      => 0.4,
			],
		];
		if ( '' !== $system_instruction ) {
			$payload['systemInstruction'] = [
				'parts' => [ [ 'text' => $system_instruction ] ],
			];
		}

		$response = wp_remote_post( $url, [
			'timeout'     => 60,
			'headers'     => [ 'Content-Type' => 'application/json' ],
			'body'        => wp_json_encode( $payload ),
			'data_format' => 'body',
		] );

		if ( is_wp_error( $response ) ) {
			return $response;
		}

		$code = wp_remote_retrieve_response_code( $response );
		$body = wp_remote_retrieve_body( $response );

		if ( $code < 200 || $code >= 300 ) {
			$err = json_decode( $body, true );
			$msg = $err['error']['message'] ?? "Gemini API error (HTTP {$code})";
			return new WP_Error( 'gemini_error', $msg );
		}

		$data = json_decode( $body, true );
		$text = $data['candidates'][0]['content']['parts'][0]['text'] ?? '';
		return self::parse_ai_response( $text );
	}

	// ── OpenAI ────────────────────────────────────────────────

	private static function call_openai( string $api_key, string $model, array $messages ) {
		$url = 'https://api.openai.com/v1/chat/completions';

		$payload = [
			'model'       => $model,
			'messages'    => $messages,
			'temperature' => 0.7,
			'response_format' => [ 'type' => 'json_object' ],
		];

		$response = wp_remote_post( $url, [
			'timeout'     => 60,
			'headers'     => [
				'Content-Type'  => 'application/json',
				'Authorization' => 'Bearer ' . $api_key,
			],
			'body'        => wp_json_encode( $payload ),
			'data_format' => 'body',
		] );

		if ( is_wp_error( $response ) ) {
			return $response;
		}

		$code = wp_remote_retrieve_response_code( $response );
		$body = wp_remote_retrieve_body( $response );

		if ( $code < 200 || $code >= 300 ) {
			$err = json_decode( $body, true );
			$msg = $err['error']['message'] ?? "OpenAI API error (HTTP {$code})";
			return new WP_Error( 'openai_error', $msg );
		}

		$data = json_decode( $body, true );
		$text = $data['choices'][0]['message']['content'] ?? '';
		return self::parse_ai_response( $text );
	}

	// ── Anthropic ─────────────────────────────────────────────

	private static function call_anthropic( string $api_key, string $model, array $messages ) {
		$url = 'https://api.anthropic.com/v1/messages';

		$system = '';
		$anthropic_messages = [];
		foreach ( $messages as $msg ) {
			if ( 'system' === $msg['role'] ) {
				$system = $msg['content'];
				continue;
			}
			$anthropic_messages[] = [
				'role'    => $msg['role'],
				'content' => $msg['content'],
			];
		}

		$payload = [
			'model'       => $model,
			'max_tokens'  => 4096,
			'temperature' => 0.7,
			'messages'    => $anthropic_messages,
		];
		if ( '' !== $system ) {
			$payload['system'] = $system;
		}

		$response = wp_remote_post( $url, [
			'timeout'     => 60,
			'headers'     => [
				'Content-Type'      => 'application/json',
				'x-api-key'         => $api_key,
				'anthropic-version' => '2023-06-01',
			],
			'body'        => wp_json_encode( $payload ),
			'data_format' => 'body',
		] );

		if ( is_wp_error( $response ) ) {
			return $response;
		}

		$code = wp_remote_retrieve_response_code( $response );
		$body = wp_remote_retrieve_body( $response );

		if ( $code < 200 || $code >= 300 ) {
			$err = json_decode( $body, true );
			$msg = $err['error']['message'] ?? "Anthropic API error (HTTP {$code})";
			return new WP_Error( 'anthropic_error', $msg );
		}

		$data = json_decode( $body, true );
		$text = $data['content'][0]['text'] ?? '';
		return self::parse_ai_response( $text );
	}

	// ── Response parsing ──────────────────────────────────────

	/**
	 * Parse the AI's text response into structured data.
	 *
	 * @return array { message: string, commands: array }
	 */
	private static function parse_ai_response( string $text ) {
		$text = trim( $text );

		// Strip markdown code fences if present
		if ( preg_match( '/^```(?:json)?\s*\n?(.*?)\n?```$/s', $text, $m ) ) {
			$text = trim( $m[1] );
		}

		$parsed = json_decode( $text, true );
		if ( ! is_array( $parsed ) ) {
			// If the entire response isn't JSON, treat it as a plain message
			return [ 'message' => $text, 'commands' => [] ];
		}

		$message  = isset( $parsed['message'] ) ? (string) $parsed['message'] : '';
		$commands = isset( $parsed['commands'] ) && is_array( $parsed['commands'] ) ? $parsed['commands'] : [];

		// Validate commands
		$valid_actions = [ 'addElement', 'updateElement', 'deleteElement', 'reparentElement' ];
		$filtered = [];
		foreach ( $commands as $cmd ) {
			if ( is_array( $cmd ) && isset( $cmd['action'] ) && in_array( $cmd['action'], $valid_actions, true ) ) {
				$filtered[] = $cmd;
			}
		}

		return [ 'message' => $message, 'commands' => $filtered ];
	}
}
