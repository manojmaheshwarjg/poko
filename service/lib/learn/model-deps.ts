/* The real, model-backed dependencies for verification: the only file in the
   learning pipeline that can reach the model. Tests never import it; they inject
   fakes. It is loaded by the verify CLI only after --confirm, and constructing it
   still calls nothing, so merely importing it costs nothing. */
import { callPlanner, completeJson, modelId } from '../planner.ts';
import { contextFor } from '../retrieval.ts';
import { LABEL_JSON_SCHEMA, LABEL_SYSTEM, LabelSchema, type Deps } from './verify.ts';

export function modelDeps(): Deps {
  return {
    /* Throws immediately if GROQ_MODEL is unset, before any call is attempted. */
    model: modelId(),
    label: async (input) => {
      const docs = input.docs ?? contextFor(input.tool, `${input.goal} ${input.steps.join(' ')}`).text;
      return completeJson({
        system: LABEL_SYSTEM,
        docs: `Documentation for ${input.tool}:\n\n${docs}`,
        user: [
          input.kind === 'destination' ? 'A route where the person only looked, and changed nothing:' : 'A route people repeatedly take:',
          ...input.steps.map((s, i) => `${i + 1}. ${s}`),
          '',
          `The point of it: ${input.goal}.`,
        ].join('\n'),
        schemaName: 'route_label',
        jsonSchema: LABEL_JSON_SCHEMA as unknown as Record<string, unknown>,
        validator: LabelSchema,
        maxTokens: 1000,
        purpose: 'label',
      });
    },
    plan: ({ tool, goal, observation }) => callPlanner({ tool, goal, observation, purpose: 'verify' }),
  };
}
