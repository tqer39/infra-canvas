import { parseDSL } from '../core/parser.js';
import { serializeDSL } from '../core/serialize.js';
import type { Diagram, Resource } from '../core/model.js';

const retainedKeys = new Set([
  'sourceKind',
  'repository',
  'commit',
  'root',
  'address',
  'file',
  'line',
  'meta.sources',
]);
function compactResource(resource: Resource): Resource {
  return {
    ...resource,
    provenance: undefined,
    attributes: Object.fromEntries(
      Object.entries(resource.attributes).filter(([key]) => !retainedKeys.has(key)),
    ),
  };
}
/** Repeated provenance stays in the app; topology and uncertainty still reach the model. */
export function modelDSL(source: string): string {
  const parsed = parseDSL(source);
  if (!parsed.diagram || parsed.diagnostics.some((item) => item.severity === 'error'))
    return source;
  return serializeDSL({
    ...parsed.diagram,
    resources: parsed.diagram.resources.map(compactResource),
  });
}
/** Only unchanged resources retain old evidence, never new or edited infrastructure. */
export function retainSourceEvidence(diagram: Diagram, source: string): Diagram {
  const original = parseDSL(source).diagram;
  if (!original) return diagram;
  const signature = (resource: Resource) =>
    JSON.stringify([
      resource.type,
      resource.label,
      resource.parentId,
      Object.entries(compactResource(resource).attributes).sort(([a], [b]) => a.localeCompare(b)),
      resource.unresolved ?? [],
    ]);
  const resources = new Map(original.resources.map((resource) => [resource.id, resource]));
  return {
    ...diagram,
    resources: diagram.resources.map((resource) => {
      const previous = resources.get(resource.id);
      if (!previous || signature(resource) !== signature(previous)) return resource;
      return {
        ...resource,
        provenance: previous.provenance,
        attributes: {
          ...resource.attributes,
          ...Object.fromEntries(
            Object.entries(previous.attributes).filter(([key]) => retainedKeys.has(key)),
          ),
        },
      };
    }),
  };
}
