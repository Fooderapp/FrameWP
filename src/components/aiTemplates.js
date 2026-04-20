/**
 * AI templates + composite builders.
 * These produce command batches that the executor can run locally
 * (zero LLM tokens for common layouts).
 *
 * Every command is the same shape as the LLM protocol:
 *   { action, type?, parentId?, props? } — parentId can be "$N" referencing
 *   an earlier command in the same batch by 0-based index.
 */

/* ── Typography variants ─────────────────────────────────── */

export const TYPO = {
  display:    { fontSize: 72, fontWeight: 800, lineHeight: 1.05, letterSpacing: -0.03 },
  h1:         { fontSize: 56, fontWeight: 800, lineHeight: 1.1,  letterSpacing: -0.02 },
  h2:         { fontSize: 44, fontWeight: 700, lineHeight: 1.15, letterSpacing: -0.02 },
  h3:         { fontSize: 32, fontWeight: 700, lineHeight: 1.2,  letterSpacing: -0.01 },
  h4:         { fontSize: 24, fontWeight: 600, lineHeight: 1.3 },
  subheading: { fontSize: 20, fontWeight: 500, lineHeight: 1.5 },
  body:       { fontSize: 16, fontWeight: 400, lineHeight: 1.6 },
  small:      { fontSize: 14, fontWeight: 400, lineHeight: 1.5 },
  caption:    { fontSize: 12, fontWeight: 500, lineHeight: 1.4, letterSpacing: 0.04 },
  badge:      { fontSize: 13, fontWeight: 600, lineHeight: 1.3, letterSpacing: 0.06 },
  buttonLabel:{ fontSize: 15, fontWeight: 600, lineHeight: 1 },
};

export const FONT_STACK = 'Inter';

/* ── Spacing scale (8px grid) ────────────────────────────── */
export const SPACE = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48, xxxl: 64, section: 96 };

/* ── Color palettes ──────────────────────────────────────── */

const PALETTES = {
  dark: {
    bg: '#0b0b14', bgAlt: '#141428', surface: '#1a1a2e',
    text: '#ffffff', textMuted: 'rgba(255,255,255,0.65)', textDim: 'rgba(255,255,255,0.45)',
    accent: '#7c3aed', accent2: '#a78bfa',
    border: 'rgba(255,255,255,0.08)',
  },
  light: {
    bg: '#ffffff', bgAlt: '#fafafa', surface: '#f5f5f7',
    text: '#0f172a', textMuted: '#64748b', textDim: '#94a3b8',
    accent: '#6366f1', accent2: '#818cf8',
    border: 'rgba(15,23,42,0.08)',
  },
};

export function pickPalette(theme = 'dark') {
  return PALETTES[theme] || PALETTES.dark;
}

/* ── Low-level command factories ─────────────────────────── */

export function cmdSection({ name = 'Section', theme = 'dark', padY = SPACE.section, padX = 80, gap = SPACE.xxl, align = 'center', justify = 'flex-start', direction = 'column', bg } = {}) {
  const pal = pickPalette(theme);
  return {
    action: 'addElement',
    type: 'frame',
    parentId: null,
    props: {
      name,
      x: 0, y: 0, width: 1440,
      widthMode: 'fixed', heightMode: 'hug', positionType: 'relative',
      styles: {
        backgroundColor: bg ?? pal.bg,
        display: 'flex', flexDirection: direction,
        alignItems: align, justifyContent: justify,
        gap,
        paddingTop: padY, paddingBottom: padY, paddingLeft: padX, paddingRight: padX,
        overflow: 'hidden',
      },
    },
  };
}

export function cmdAutoLayout({ parentId, name = 'Stack', direction = 'column', gap = SPACE.md, padding = 0, align = 'flex-start', justify = 'flex-start', sizing = 'hug', width, height, bg, radius = 0 } = {}) {
  const widthMode = sizing === 'fill' ? 'fill' : sizing === 'fixed' ? 'fixed' : 'hug';
  const heightMode = 'hug';
  const pad = typeof padding === 'number' ? { t: padding, r: padding, b: padding, l: padding } : padding;
  return {
    action: 'addElement',
    type: 'frame',
    parentId,
    props: {
      name, widthMode, heightMode,
      ...(width != null ? { width } : {}),
      ...(height != null ? { height } : {}),
      styles: {
        display: 'flex', flexDirection: direction,
        gap, alignItems: align, justifyContent: justify,
        paddingTop: pad.t, paddingRight: pad.r, paddingBottom: pad.b, paddingLeft: pad.l,
        ...(bg ? { backgroundColor: bg } : {}),
        ...(radius ? { borderRadius: radius } : {}),
      },
    },
  };
}

export function cmdText({ parentId, name, text, variant = 'body', color, align = 'left', sizing = 'hug', width, extra = {} } = {}) {
  const typo = TYPO[variant] || TYPO.body;
  const widthMode = sizing === 'fill' ? 'fill' : 'hug';
  return {
    action: 'addElement',
    type: 'text',
    parentId,
    props: {
      name: name || `Text (${variant})`,
      text,
      widthMode, heightMode: 'hug',
      ...(sizing === 'fixed' && width ? { width, widthMode: 'fixed' } : {}),
      styles: {
        fontFamily: FONT_STACK,
        ...typo,
        ...(color ? { color } : {}),
        textAlign: align,
        ...extra,
      },
    },
  };
}

export function cmdButton({ parentId, label = 'Get started', variant = 'primary', theme = 'dark', refIndex } = {}) {
  const pal = pickPalette(theme);
  const styles = variant === 'primary'
    ? { backgroundColor: pal.accent, color: '#ffffff' }
    : variant === 'ghost'
      ? { backgroundColor: 'transparent', color: pal.text, borderWidth: 1, borderColor: pal.border, borderStyle: 'solid' }
      : { backgroundColor: pal.surface, color: pal.text };

  const out = [];
  const btnIdx = refIndex;
  out.push({
    action: 'addElement',
    type: 'frame',
    parentId,
    props: {
      name: `Button (${variant})`,
      widthMode: 'hug', heightMode: 'hug',
      styles: {
        display: 'flex', flexDirection: 'row',
        alignItems: 'center', justifyContent: 'center',
        gap: 8,
        paddingTop: 14, paddingBottom: 14, paddingLeft: 28, paddingRight: 28,
        borderRadius: 10,
        backgroundColor: styles.backgroundColor,
        ...(styles.borderWidth ? { borderWidth: styles.borderWidth, borderColor: styles.borderColor, borderStyle: styles.borderStyle } : {}),
      },
    },
  });
  out.push({
    action: 'addElement',
    type: 'text',
    parentId: `$${btnIdx}`,
    props: {
      name: 'Button Label',
      text: label,
      widthMode: 'hug', heightMode: 'hug',
      styles: {
        fontFamily: FONT_STACK,
        ...TYPO.buttonLabel,
        color: styles.color,
      },
    },
  });
  return out;
}

/* ── Composite/template recipes ──────────────────────────── */

export function tplHero({ theme = 'dark', eyebrow = '✨ Introducing v2.0', heading = 'Build beautiful websites\nwithout writing code', subtitle = 'The most intuitive visual builder for WordPress.\nDesign, iterate, and ship — all from one canvas.', primaryCta = 'Get started free', secondaryCta = 'Watch demo →' } = {}) {
  const pal = pickPalette(theme);
  const cmds = [];
  // 0: section
  cmds.push(cmdSection({ name: 'Hero Section', theme, padY: 120, padX: 80, gap: SPACE.xl, align: 'center', justify: 'center' }));
  // 1: eyebrow badge
  cmds.push(cmdText({
    parentId: '$0', name: 'Eyebrow', text: eyebrow, variant: 'badge', color: pal.accent2, align: 'center',
    extra: {
      backgroundColor: theme === 'dark' ? 'rgba(167,139,250,0.12)' : 'rgba(99,102,241,0.1)',
      paddingTop: 8, paddingBottom: 8, paddingLeft: 18, paddingRight: 18,
      borderRadius: 100,
    },
  }));
  // 2: heading
  cmds.push(cmdText({ parentId: '$0', name: 'Heading', text: heading, variant: 'display', color: pal.text, align: 'center' }));
  // 3: subtitle
  cmds.push(cmdText({ parentId: '$0', name: 'Subtitle', text: subtitle, variant: 'subheading', color: pal.textMuted, align: 'center' }));
  // 4: cta row (auto-layout)
  cmds.push(cmdAutoLayout({ parentId: '$0', name: 'CTA Row', direction: 'row', gap: SPACE.md, align: 'center' }));
  // 5,6: primary button (frame + label)
  const primBase = cmds.length;
  cmds.push(...cmdButton({ parentId: '$4', label: primaryCta, variant: 'primary', theme, refIndex: primBase }));
  // 7,8: secondary button
  const secBase = cmds.length;
  cmds.push(...cmdButton({ parentId: '$4', label: secondaryCta, variant: 'ghost', theme, refIndex: secBase }));
  return cmds;
}

export function tplNavbar({ theme = 'dark', brand = 'Acme', links = ['Product', 'Pricing', 'Docs', 'Blog'] } = {}) {
  const pal = pickPalette(theme);
  const cmds = [];
  // 0: nav section
  cmds.push({
    action: 'addElement', type: 'frame', parentId: null,
    props: {
      name: 'Navbar', x: 0, y: 0, width: 1440,
      widthMode: 'fixed', heightMode: 'hug', positionType: 'relative',
      styles: {
        backgroundColor: pal.bg,
        display: 'flex', flexDirection: 'row',
        alignItems: 'center', justifyContent: 'space-between',
        paddingTop: 20, paddingBottom: 20, paddingLeft: 80, paddingRight: 80,
        borderWidth: 1, borderColor: pal.border, borderStyle: 'solid',
      },
    },
  });
  // 1: brand
  cmds.push(cmdText({ parentId: '$0', name: 'Brand', text: brand, variant: 'h4', color: pal.text }));
  // 2: link row
  cmds.push(cmdAutoLayout({ parentId: '$0', name: 'Links', direction: 'row', gap: SPACE.xl, align: 'center' }));
  // 3..N: links
  links.forEach((label, i) => {
    cmds.push(cmdText({ parentId: '$2', name: `Link ${i + 1}`, text: label, variant: 'small', color: pal.textMuted }));
  });
  // trailing CTA
  const btnBase = cmds.length;
  cmds.push(...cmdButton({ parentId: '$0', label: 'Sign in', variant: 'primary', theme, refIndex: btnBase }));
  return cmds;
}

export function tplFeatures({ theme = 'light', title = 'Everything you need', subtitle = 'Powerful features that scale with your workflow.', items = [
  { title: 'Lightning Fast', body: 'Built for performance from the ground up. Every interaction feels instant.' },
  { title: 'Fully Responsive', body: 'Looks perfect on every screen size. Desktop, tablet and mobile — all covered.' },
  { title: 'Easy to Use', body: 'No coding required. Drag, drop and customize with an intuitive interface.' },
] } = {}) {
  const pal = pickPalette(theme);
  const cmds = [];
  // 0: section
  cmds.push(cmdSection({ name: 'Features Section', theme, padY: 100, padX: 80, gap: SPACE.xxxl, align: 'center' }));
  // 1: title
  cmds.push(cmdText({ parentId: '$0', name: 'Title', text: title, variant: 'h2', color: pal.text, align: 'center' }));
  // 2: subtitle
  cmds.push(cmdText({ parentId: '$0', name: 'Subtitle', text: subtitle, variant: 'subheading', color: pal.textMuted, align: 'center' }));
  // 3: cards row
  cmds.push(cmdAutoLayout({ parentId: '$0', name: 'Cards Row', direction: 'row', gap: SPACE.lg, align: 'stretch', sizing: 'fill' }));
  // 4..: cards
  items.forEach((item, i) => {
    const cardIdx = cmds.length;
    cmds.push({
      action: 'addElement', type: 'frame', parentId: '$3',
      props: {
        name: `Card ${i + 1}`,
        widthMode: 'fill', heightMode: 'hug',
        styles: {
          display: 'flex', flexDirection: 'column', gap: SPACE.md,
          paddingTop: 32, paddingBottom: 32, paddingLeft: 28, paddingRight: 28,
          backgroundColor: pal.bgAlt,
          borderRadius: 16,
          borderWidth: 1, borderColor: pal.border, borderStyle: 'solid',
        },
      },
    });
    cmds.push(cmdText({ parentId: `$${cardIdx}`, name: `Card ${i + 1} Title`, text: item.title, variant: 'h4', color: pal.text }));
    cmds.push(cmdText({ parentId: `$${cardIdx}`, name: `Card ${i + 1} Body`, text: item.body, variant: 'body', color: pal.textMuted, sizing: 'fill' }));
  });
  return cmds;
}

export function tplCta({ theme = 'dark', heading = 'Ready to build?', subtitle = 'Start creating in minutes. No credit card required.', ctaLabel = 'Start free trial' } = {}) {
  const pal = pickPalette(theme);
  const cmds = [];
  cmds.push(cmdSection({ name: 'CTA Section', theme, padY: 100, padX: 80, gap: SPACE.lg, align: 'center', justify: 'center' }));
  cmds.push(cmdText({ parentId: '$0', name: 'CTA Heading', text: heading, variant: 'h1', color: pal.text, align: 'center' }));
  cmds.push(cmdText({ parentId: '$0', name: 'CTA Subtitle', text: subtitle, variant: 'subheading', color: pal.textMuted, align: 'center' }));
  const btnBase = cmds.length;
  cmds.push(...cmdButton({ parentId: '$0', label: ctaLabel, variant: 'primary', theme, refIndex: btnBase }));
  return cmds;
}

export function tplFooter({ theme = 'dark', brand = 'Acme', copyright = '© 2026 Acme, Inc.' } = {}) {
  const pal = pickPalette(theme);
  const cmds = [];
  cmds.push({
    action: 'addElement', type: 'frame', parentId: null,
    props: {
      name: 'Footer', x: 0, y: 0, width: 1440,
      widthMode: 'fixed', heightMode: 'hug', positionType: 'relative',
      styles: {
        backgroundColor: pal.bg,
        display: 'flex', flexDirection: 'row',
        alignItems: 'center', justifyContent: 'space-between',
        paddingTop: 40, paddingBottom: 40, paddingLeft: 80, paddingRight: 80,
        borderWidth: 1, borderColor: pal.border, borderStyle: 'solid',
      },
    },
  });
  cmds.push(cmdText({ parentId: '$0', name: 'Brand', text: brand, variant: 'h4', color: pal.text }));
  cmds.push(cmdText({ parentId: '$0', name: 'Copyright', text: copyright, variant: 'small', color: pal.textMuted }));
  return cmds;
}

export const TEMPLATES = {
  hero:         { build: tplHero,         label: 'Hero section' },
  navbar:       { build: tplNavbar,       label: 'Navigation bar' },
  features:     { build: tplFeatures,     label: 'Feature grid' },
  cta:          { build: tplCta,          label: 'CTA section' },
  footer:       { build: tplFooter,       label: 'Footer' },
  contactForm:  { build: tplContactForm,  label: 'Contact form' },
  videoSection: { build: tplVideoSection, label: 'Video section' },
  testimonials: { build: tplTestimonials, label: 'Testimonials section' },
  pricing:      { build: tplPricing,      label: 'Pricing section' },
  faq:          { build: tplFaq,          label: 'FAQ section' },
};

/* ── New template builders ───────────────────────────────── */

export function tplContactForm({ theme = 'light', heading = 'Get in touch', subtitle = 'Fill out the form below and we\'ll get back to you within 24 hours.' } = {}) {
  const pal = pickPalette(theme);
  const cmds = [];
  // 0: section
  cmds.push(cmdSection({ name: 'Contact Section', theme, padY: 100, padX: 80, gap: SPACE.xxl, align: 'center' }));
  // 1: heading
  cmds.push(cmdText({ parentId: '$0', name: 'Contact Heading', text: heading, variant: 'h2', color: pal.text, align: 'center' }));
  // 2: subtitle
  cmds.push(cmdText({ parentId: '$0', name: 'Contact Subtitle', text: subtitle, variant: 'subheading', color: pal.textMuted, align: 'center' }));
  // 3: form container
  cmds.push({
    action: 'addElement', type: 'form', parentId: '$0',
    props: {
      name: 'Contact Form',
      widthMode: 'fixed', width: 560, heightMode: 'hug',
      styles: {
        display: 'flex', flexDirection: 'column', gap: 14,
        backgroundColor: theme === 'dark' ? 'rgba(26,26,46,0.96)' : 'rgba(248,250,252,0.96)',
        borderRadius: 20,
        paddingTop: 32, paddingRight: 32, paddingBottom: 32, paddingLeft: 32,
        borderWidth: 1, borderColor: theme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(148,163,184,0.42)', borderStyle: 'solid',
        boxShadow: '0 12px 28px rgba(15,23,42,0.08)',
      },
    },
  });
  // 4: name row (two fields side by side)
  cmds.push(cmdAutoLayout({ parentId: '$3', name: 'Name Row', direction: 'row', gap: 12, sizing: 'fill' }));
  // 5: first name
  cmds.push({
    action: 'addElement', type: 'text-field', parentId: '$4',
    props: { name: 'First Name', widthMode: 'fill', placeholder: 'First name', label: 'First Name', fieldName: 'first_name', required: true },
  });
  // 6: last name
  cmds.push({
    action: 'addElement', type: 'text-field', parentId: '$4',
    props: { name: 'Last Name', widthMode: 'fill', placeholder: 'Last name', label: 'Last Name', fieldName: 'last_name', required: true },
  });
  // 7: email
  cmds.push({
    action: 'addElement', type: 'text-field', parentId: '$3',
    props: { name: 'Email', widthMode: 'fill', placeholder: 'you@example.com', label: 'Email', fieldName: 'email', required: true },
  });
  // 8: message
  cmds.push({
    action: 'addElement', type: 'textarea-field', parentId: '$3',
    props: { name: 'Message', widthMode: 'fill', placeholder: 'How can we help?', label: 'Message', fieldName: 'message' },
  });
  // 9: submit
  cmds.push({
    action: 'addElement', type: 'submit-button', parentId: '$3',
    props: { name: 'Submit', widthMode: 'fill', label: 'Send message' },
  });
  return cmds;
}

export function tplVideoSection({ theme = 'dark', heading = 'See it in action', subtitle = 'Watch how easy it is to build a complete website in minutes.' } = {}) {
  const pal = pickPalette(theme);
  const cmds = [];
  // 0: section
  cmds.push(cmdSection({ name: 'Video Section', theme, padY: 100, padX: 80, gap: SPACE.xxl, align: 'center' }));
  // 1: heading
  cmds.push(cmdText({ parentId: '$0', name: 'Video Heading', text: heading, variant: 'h2', color: pal.text, align: 'center' }));
  // 2: subtitle
  cmds.push(cmdText({ parentId: '$0', name: 'Video Subtitle', text: subtitle, variant: 'subheading', color: pal.textMuted, align: 'center' }));
  // 3: video element
  cmds.push({
    action: 'addElement', type: 'video', parentId: '$0',
    props: {
      name: 'Demo Video',
      width: 1280, height: 720, widthMode: 'fixed', heightMode: 'fixed',
      videoProvider: 'upload', videoControls: true, videoAutoplay: false, videoMuted: true,
      styles: { borderRadius: 16, overflow: 'hidden', boxShadow: '0 24px 64px rgba(0,0,0,0.2)' },
    },
  });
  return cmds;
}

export function tplTestimonials({ theme = 'light', title = 'What people are saying', items = [
  { quote: '"This completely changed how we build websites. The speed is unreal."', author: 'Sarah Chen', role: 'Head of Design, Acme' },
  { quote: '"We shipped our redesign in 2 days instead of 2 months. Game changer."', author: 'Mike Roberts', role: 'CTO, StartupCo' },
  { quote: '"The most intuitive builder I\'ve ever used. My team was productive day one."', author: 'Lisa Park', role: 'Product Lead, BigCorp' },
] } = {}) {
  const pal = pickPalette(theme);
  const cmds = [];
  // 0: section
  cmds.push(cmdSection({ name: 'Testimonials Section', theme, padY: 100, padX: 80, gap: SPACE.xxxl, align: 'center' }));
  // 1: title
  cmds.push(cmdText({ parentId: '$0', name: 'Testimonials Title', text: title, variant: 'h2', color: pal.text, align: 'center' }));
  // 2: cards row
  cmds.push(cmdAutoLayout({ parentId: '$0', name: 'Testimonials Row', direction: 'row', gap: SPACE.lg, align: 'stretch', sizing: 'fill' }));
  // 3..: testimonial cards
  items.forEach((item, i) => {
    const cardIdx = cmds.length;
    cmds.push({
      action: 'addElement', type: 'frame', parentId: '$2',
      props: {
        name: `Testimonial ${i + 1}`,
        widthMode: 'fill', heightMode: 'hug',
        styles: {
          display: 'flex', flexDirection: 'column', gap: SPACE.lg,
          paddingTop: 32, paddingBottom: 32, paddingLeft: 28, paddingRight: 28,
          backgroundColor: pal.bgAlt,
          borderRadius: 16,
          borderWidth: 1, borderColor: pal.border, borderStyle: 'solid',
        },
      },
    });
    cmds.push(cmdText({ parentId: `$${cardIdx}`, name: 'Quote', text: item.quote, variant: 'body', color: pal.text, sizing: 'fill', extra: { fontStyle: 'italic' } }));
    const authorIdx = cmds.length;
    cmds.push(cmdAutoLayout({ parentId: `$${cardIdx}`, name: 'Author', direction: 'column', gap: 4 }));
    cmds.push(cmdText({ parentId: `$${authorIdx}`, name: 'Author Name', text: item.author, variant: 'small', color: pal.text, extra: { fontWeight: 600 } }));
    cmds.push(cmdText({ parentId: `$${authorIdx}`, name: 'Author Role', text: item.role, variant: 'caption', color: pal.textMuted }));
  });
  return cmds;
}

export function tplPricing({ theme = 'light', title = 'Simple, transparent pricing', subtitle = 'No hidden fees. Cancel anytime.', plans = [
  { name: 'Starter', price: '$0', period: '/month', features: ['5 pages', '1 GB storage', 'Basic support'], cta: 'Get started', variant: 'secondary' },
  { name: 'Pro', price: '$29', period: '/month', features: ['Unlimited pages', '50 GB storage', 'Priority support', 'Custom domain'], cta: 'Start free trial', variant: 'primary' },
  { name: 'Enterprise', price: '$99', period: '/month', features: ['Everything in Pro', 'SSO & SAML', 'Dedicated account manager', 'SLA guarantee'], cta: 'Contact sales', variant: 'secondary' },
] } = {}) {
  const pal = pickPalette(theme);
  const cmds = [];
  // 0: section
  cmds.push(cmdSection({ name: 'Pricing Section', theme, padY: 100, padX: 80, gap: SPACE.xxxl, align: 'center' }));
  // 1: title
  cmds.push(cmdText({ parentId: '$0', name: 'Pricing Title', text: title, variant: 'h2', color: pal.text, align: 'center' }));
  // 2: subtitle
  cmds.push(cmdText({ parentId: '$0', name: 'Pricing Subtitle', text: subtitle, variant: 'subheading', color: pal.textMuted, align: 'center' }));
  // 3: cards row
  cmds.push(cmdAutoLayout({ parentId: '$0', name: 'Pricing Row', direction: 'row', gap: SPACE.lg, align: 'stretch', sizing: 'fill' }));
  // 4..: pricing cards
  plans.forEach((plan, i) => {
    const cardIdx = cmds.length;
    const isPopular = plan.variant === 'primary';
    cmds.push({
      action: 'addElement', type: 'frame', parentId: '$3',
      props: {
        name: `${plan.name} Plan`,
        widthMode: 'fill', heightMode: 'hug',
        styles: {
          display: 'flex', flexDirection: 'column', gap: SPACE.lg,
          paddingTop: 40, paddingBottom: 40, paddingLeft: 32, paddingRight: 32,
          backgroundColor: isPopular ? pal.accent : pal.bgAlt,
          borderRadius: 20,
          borderWidth: isPopular ? 0 : 1, borderColor: pal.border, borderStyle: 'solid',
        },
      },
    });
    cmds.push(cmdText({ parentId: `$${cardIdx}`, name: 'Plan Name', text: plan.name, variant: 'h4', color: isPopular ? '#ffffff' : pal.text }));
    // Price row
    const priceIdx = cmds.length;
    cmds.push(cmdAutoLayout({ parentId: `$${cardIdx}`, name: 'Price Row', direction: 'row', gap: 4, align: 'baseline' }));
    cmds.push(cmdText({ parentId: `$${priceIdx}`, name: 'Price', text: plan.price, variant: 'display', color: isPopular ? '#ffffff' : pal.text }));
    cmds.push(cmdText({ parentId: `$${priceIdx}`, name: 'Period', text: plan.period, variant: 'body', color: isPopular ? 'rgba(255,255,255,0.7)' : pal.textMuted }));
    // Features list
    const listIdx = cmds.length;
    cmds.push(cmdAutoLayout({ parentId: `$${cardIdx}`, name: 'Features', direction: 'column', gap: 12 }));
    plan.features.forEach((f) => {
      cmds.push(cmdText({ parentId: `$${listIdx}`, name: 'Feature', text: `✓  ${f}`, variant: 'body', color: isPopular ? 'rgba(255,255,255,0.9)' : pal.textMuted }));
    });
    // CTA button
    const btnBase = cmds.length;
    cmds.push(...cmdButton({ parentId: `$${cardIdx}`, label: plan.cta, variant: isPopular ? 'ghost' : 'primary', theme, refIndex: btnBase }));
  });
  return cmds;
}

export function tplFaq({ theme = 'light', title = 'Frequently asked questions', items = [
  { q: 'How do I get started?', a: 'Sign up for a free account, pick a template, and start customizing. No credit card required.' },
  { q: 'Can I use my own domain?', a: 'Yes! Connect any custom domain from the settings panel. We handle SSL automatically.' },
  { q: 'Is there a free plan?', a: 'Absolutely. Our Starter plan is free forever with generous limits for personal projects.' },
  { q: 'How do I contact support?', a: 'Use the in-app chat or email hello@acme.com. We typically respond within a few hours.' },
] } = {}) {
  const pal = pickPalette(theme);
  const cmds = [];
  // 0: section
  cmds.push(cmdSection({ name: 'FAQ Section', theme, padY: 100, padX: 80, gap: SPACE.xxxl, align: 'center' }));
  // 1: title
  cmds.push(cmdText({ parentId: '$0', name: 'FAQ Title', text: title, variant: 'h2', color: pal.text, align: 'center' }));
  // 2: faq list
  cmds.push(cmdAutoLayout({ parentId: '$0', name: 'FAQ List', direction: 'column', gap: 0, sizing: 'fixed', width: 800, align: 'stretch' }));
  // 3..: faq items
  items.forEach((item, i) => {
    const itemIdx = cmds.length;
    cmds.push(cmdAutoLayout({
      parentId: '$2', name: `FAQ ${i + 1}`, direction: 'column', gap: 12, sizing: 'fill',
      padding: { t: 24, r: 0, b: 24, l: 0 },
      ...(i < items.length - 1 ? {} : {}),
    }));
    cmds.push(cmdText({ parentId: `$${itemIdx}`, name: 'Question', text: item.q, variant: 'h4', color: pal.text, sizing: 'fill' }));
    cmds.push(cmdText({ parentId: `$${itemIdx}`, name: 'Answer', text: item.a, variant: 'body', color: pal.textMuted, sizing: 'fill' }));
  });
  return cmds;
}
