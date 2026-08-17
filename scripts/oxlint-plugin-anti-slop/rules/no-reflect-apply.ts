import { defineRule } from "@oxlint/plugins";
import type { ESTree, Scope, SourceCode, Variable } from "@oxlint/plugins";

function resolveVariable(
  sourceCode: SourceCode,
  identifier: ESTree.IdentifierReference,
): Variable | null {
  let scope: Scope | null = sourceCode.getScope(identifier);
  while (scope !== null) {
    const variable = scope.set.get(identifier.name);
    if (variable !== undefined) return variable;
    scope = scope.upper;
  }
  return null;
}

function isGlobalReflectApply(
  sourceCode: SourceCode,
  callee: ESTree.Expression,
): boolean {
  if (
    !("property" in callee) ||
    !("object" in callee) ||
    !("computed" in callee) ||
    callee.object.type !== "Identifier" ||
    callee.object.name !== "Reflect"
  ) {
    return false;
  }

  const variable = resolveVariable(sourceCode, callee.object);
  if (
    !sourceCode.isGlobalReference(callee.object) &&
    variable !== null &&
    variable.defs.length > 0
  ) {
    return false;
  }

  return callee.computed
    ? callee.property.type === "Literal" && callee.property.value === "apply"
    : callee.property.type === "Identifier" && callee.property.name === "apply";
}

/** Ban Reflect.apply, which bypasses ordinary typed function calls. */
export const noReflectApplyRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow Reflect.apply; call typed functions directly or model dynamic dispatch behind an interface.",
    },
    messages: {
      reflectApply:
        "Replace `Reflect.apply` with a typed function call. Model dynamic dispatch behind a named interface.",
    },
  },
  createOnce(context) {
    return {
      CallExpression(node) {
        if (
          node.callee.type === "Super" ||
          node.callee.type === "V8IntrinsicExpression"
        )
          return;
        if (isGlobalReflectApply(context.sourceCode, node.callee)) {
          context.report({ node, messageId: "reflectApply" });
        }
      },
    };
  },
});
