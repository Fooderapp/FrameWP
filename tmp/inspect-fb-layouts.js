const fs = require('fs');

for (const id of [50, 5]) {
  const path = `/tmp/fb_layout_${id}.json`;
  const raw = fs.readFileSync(path, 'utf8').trim();
  const layout = JSON.parse(raw);
  const elements = Array.isArray(layout.elements) ? layout.elements : [];
  const flows = Array.isArray(layout.flows) ? layout.flows : [];

  const forms = elements
    .filter((element) => element && element.type === 'form')
    .map((form) => ({
      id: form.id,
      name: form.name,
      legacyActions: form.base?.formConfig?.actions ?? null,
    }));

  const flowSummary = flows
    .map((flow) => ({
      id: flow.id,
      name: flow.name,
      trigger: flow.trigger,
      submissionNodes: (Array.isArray(flow.nodes) ? flow.nodes : [])
        .filter((node) => node && node.type === 'submission-form')
        .map((node) => ({
          id: node.id,
          fields: node.config?.fields ?? [],
          actions: node.config?.actions ?? null,
        })),
    }))
    .filter((flow) => flow.submissionNodes.length || flow.trigger?.type === 'form-submit');

  console.log(`\nPAGE ${id}`);
  console.log(JSON.stringify({ forms, flowSummary }, null, 2));
}