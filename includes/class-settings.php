<?php
defined( 'ABSPATH' ) || exit;

class FrameBuilder_Settings {

	const OPTION_AI_PROVIDER = 'fb_ai_provider';
	const OPTION_AI_API_KEY  = 'fb_ai_api_key';
	const OPTION_AI_MODEL    = 'fb_ai_model';

	/** Default provider → model mapping. */
	private static array $default_models = [
		'gemini'  => 'gemini-2.5-flash',
		'openai'  => 'gpt-4o-mini',
		'anthropic' => 'claude-3-5-haiku-20241022',
	];

	public static function init(): void {
		add_action( 'admin_menu', [ __CLASS__, 'add_settings_page' ] );
		add_action( 'admin_init', [ __CLASS__, 'register_settings' ] );
	}

	public static function add_settings_page(): void {
		add_submenu_page(
			'framebuilder',
			__( 'Settings', 'framebuilder' ),
			__( 'Settings', 'framebuilder' ),
			'manage_options',
			'framebuilder-settings',
			[ __CLASS__, 'render_settings_page' ]
		);
	}

	public static function register_settings(): void {
		register_setting( 'fb_settings', self::OPTION_AI_PROVIDER, [
			'type'              => 'string',
			'sanitize_callback' => 'sanitize_text_field',
			'default'           => 'gemini',
		] );
		register_setting( 'fb_settings', self::OPTION_AI_API_KEY, [
			'type'              => 'string',
			'sanitize_callback' => 'sanitize_text_field',
			'default'           => '',
		] );
		register_setting( 'fb_settings', self::OPTION_AI_MODEL, [
			'type'              => 'string',
			'sanitize_callback' => 'sanitize_text_field',
			'default'           => '',
		] );

		add_settings_section( 'fb_ai_section', __( 'AI Assistant', 'framebuilder' ), [ __CLASS__, 'render_ai_section' ], 'fb_settings' );

		add_settings_field( 'fb_ai_provider', __( 'Provider', 'framebuilder' ), [ __CLASS__, 'render_provider_field' ], 'fb_settings', 'fb_ai_section' );
		add_settings_field( 'fb_ai_api_key',  __( 'API Key', 'framebuilder' ),  [ __CLASS__, 'render_api_key_field' ],  'fb_settings', 'fb_ai_section' );
		add_settings_field( 'fb_ai_model',    __( 'Model', 'framebuilder' ),    [ __CLASS__, 'render_model_field' ],    'fb_settings', 'fb_ai_section' );
	}

	public static function render_ai_section(): void {
		echo '<p>' . esc_html__( 'Connect an AI provider to enable the AI assistant inside the builder. Your API key is stored securely and never sent to third parties.', 'framebuilder' ) . '</p>';
	}

	public static function render_provider_field(): void {
		$value = get_option( self::OPTION_AI_PROVIDER, 'gemini' );
		?>
		<select name="<?php echo esc_attr( self::OPTION_AI_PROVIDER ); ?>" id="fb_ai_provider">
			<option value="gemini"    <?php selected( $value, 'gemini' ); ?>>Google Gemini</option>
			<option value="openai"    <?php selected( $value, 'openai' ); ?>>OpenAI</option>
			<option value="anthropic" <?php selected( $value, 'anthropic' ); ?>>Anthropic</option>
		</select>
		<p class="description"><?php esc_html_e( 'Gemini Flash is the most cost-effective option (~$0.10/1M tokens).', 'framebuilder' ); ?></p>
		<?php
	}

	public static function render_api_key_field(): void {
		$value = get_option( self::OPTION_AI_API_KEY, '' );
		?>
		<input
			type="password"
			name="<?php echo esc_attr( self::OPTION_AI_API_KEY ); ?>"
			id="fb_ai_api_key"
			value="<?php echo esc_attr( $value ); ?>"
			class="regular-text"
			autocomplete="off"
		/>
		<p class="description"><?php esc_html_e( 'Get your API key from the provider\'s console. The key is stored in your WordPress database.', 'framebuilder' ); ?></p>
		<?php
	}

	public static function render_model_field(): void {
		$value = get_option( self::OPTION_AI_MODEL, '' );
		$provider = get_option( self::OPTION_AI_PROVIDER, 'gemini' );
		$placeholder = self::$default_models[ $provider ] ?? 'gemini-2.5-flash';
		?>
		<input
			type="text"
			name="<?php echo esc_attr( self::OPTION_AI_MODEL ); ?>"
			id="fb_ai_model"
			value="<?php echo esc_attr( $value ); ?>"
			class="regular-text"
			placeholder="<?php echo esc_attr( $placeholder ); ?>"
		/>
		<p class="description"><?php esc_html_e( 'Leave empty to use the default model for the selected provider.', 'framebuilder' ); ?></p>
		<?php
	}

	public static function render_settings_page(): void {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}
		?>
		<div class="wrap">
			<h1><?php esc_html_e( 'FrameBuilder Settings', 'framebuilder' ); ?></h1>
			<form method="post" action="options.php">
				<?php
				settings_fields( 'fb_settings' );
				do_settings_sections( 'fb_settings' );
				submit_button();
				?>
			</form>
		</div>
		<?php
	}

	// ── Helpers for runtime use ──────────────────────────────

	public static function get_ai_provider(): string {
		return get_option( self::OPTION_AI_PROVIDER, 'gemini' ) ?: 'gemini';
	}

	public static function get_ai_api_key(): string {
		return get_option( self::OPTION_AI_API_KEY, '' ) ?: '';
	}

	public static function get_ai_model(): string {
		$model = get_option( self::OPTION_AI_MODEL, '' );
		if ( $model && '' !== trim( $model ) ) {
			return trim( $model );
		}
		$provider = self::get_ai_provider();
		return self::$default_models[ $provider ] ?? 'gemini-2.5-flash';
	}

	/**
	 * Whether the AI feature is configured (has an API key).
	 */
	public static function is_ai_enabled(): bool {
		return '' !== self::get_ai_api_key();
	}
}
