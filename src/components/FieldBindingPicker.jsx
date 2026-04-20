import React, { useMemo } from 'react';
import { useEditorStore } from '../store/editorStore';

/* Phase 5: WooCommerce / Post field binding picker.
 *
 * Bindings are stored as strings like "post.title", "product.price".
 * The exporter resolves them to actual WP values at render time.
 */

const POST_FIELDS = [
  { value: 'post.title',          label: 'Title',             kind: 'text' },
  { value: 'post.excerpt',        label: 'Excerpt',           kind: 'text' },
  { value: 'post.content',        label: 'Content',           kind: 'text' },
  { value: 'post.date',           label: 'Date',              kind: 'text' },
  { value: 'post.author',         label: 'Author',            kind: 'text' },
  { value: 'post.permalink',      label: 'Permalink',         kind: 'text' },
  { value: 'post.featured_image', label: 'Featured image',    kind: 'image' },
];

const PRODUCT_FIELDS = [
  { value: 'product.title',             label: 'Title',             kind: 'text' },
  { value: 'product.price',             label: 'Price',             kind: 'text' },
  { value: 'product.regular_price',     label: 'Regular price',     kind: 'text' },
  { value: 'product.sale_price',        label: 'Sale price',        kind: 'text' },
  { value: 'product.sku',               label: 'SKU',               kind: 'text' },
  { value: 'product.stock_status',      label: 'Stock status',      kind: 'text' },
  { value: 'product.short_description', label: 'Short description', kind: 'text' },
  { value: 'product.description',       label: 'Description',       kind: 'text' },
  { value: 'product.permalink',         label: 'Permalink',         kind: 'text' },
  { value: 'product.featured_image',    label: 'Featured image',    kind: 'image' },
];

export function getAvailableBindingOptions({ templateType, inLoop, kind, formTargets }) {
  const groups = [];
  const wooActive = !!(window.fbData?.woocommerce_active);
  const isPostCtx = templateType === 'post-single' || templateType === 'post-archive' || inLoop;
  const isProductCtx = templateType === 'woo-product' || templateType === 'woo-category' || templateType === 'woo-shop' || inLoop;

  if (isPostCtx) {
    const items = kind ? POST_FIELDS.filter((o) => o.kind === kind) : POST_FIELDS;
    if (items.length) groups.push({ label: 'Post', items });
  }
  if (isProductCtx && wooActive) {
    const items = kind ? PRODUCT_FIELDS.filter((o) => o.kind === kind) : PRODUCT_FIELDS;
    if (items.length) groups.push({ label: 'Product', items });
  }

  const targets = formTargets || {};
  if (isPostCtx && Array.isArray(targets.post?.acfFields) && targets.post.acfFields.length) {
    const acfItems = targets.post.acfFields
      .filter((f) => {
        if (!kind) return true;
        return kind === 'image' ? f.type === 'image' : f.type !== 'image';
      })
      .map((f) => ({ value: `acf.${f.name}`, label: f.label || f.name, kind: f.type === 'image' ? 'image' : 'text' }));
    if (acfItems.length) groups.push({ label: 'ACF (Post)', items: acfItems });
  }
  if (isProductCtx && wooActive && Array.isArray(targets.product?.acfFields) && targets.product.acfFields.length) {
    const acfItems = targets.product.acfFields
      .filter((f) => {
        if (!kind) return true;
        return kind === 'image' ? f.type === 'image' : f.type !== 'image';
      })
      .map((f) => ({ value: `acf.${f.name}`, label: f.label || f.name, kind: f.type === 'image' ? 'image' : 'text' }));
    if (acfItems.length) groups.push({ label: 'ACF (Product)', items: acfItems });
  }

  return groups;
}

export default function FieldBindingPicker({ element, kind, templateType, inLoop, onChange }) {
  const binding = element?.base?.binding || '';
  const formTargets = useEditorStore((s) => s.variableSources?.formTargets);
  const groups = useMemo(
    () => getAvailableBindingOptions({ templateType, inLoop, kind, formTargets }),
    [templateType, inLoop, kind, formTargets],
  );
  const hasAny = groups.some((g) => g.items.length > 0);
  if (!hasAny) return null;

  return (
    <div className="fb-prop-row" style={{ marginBottom: 8 }}>
      <label className="fb-prop-label">Bind</label>
      <select
        className="fb-prop-input"
        value={binding}
        onChange={(e) => onChange(e.target.value || '')}
      >
        <option value="">— Not bound —</option>
        {groups.map((g) => (
          <optgroup key={g.label} label={g.label}>
            {g.items.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}
