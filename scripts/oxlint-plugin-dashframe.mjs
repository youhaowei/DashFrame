const credentialClassValues = new Set([
  "assistant-provider",
  "connector-key",
  "serve-token",
]);

export default {
  meta: {
    name: "dashframe",
  },
  rules: {
    "credential-class-literals": {
      meta: {
        type: "problem",
        docs: {
          description:
            "Require DashFrame credential-class values to come from CREDENTIAL_CLASS.",
        },
        messages: {
          useConstant:
            "Don't hand-write this credential-class string literal — import CREDENTIAL_CLASS from packages/server-core/src/credential-classes.ts instead.",
        },
      },
      create(context) {
        return {
          Literal(node) {
            if (
              typeof node.value === "string" &&
              credentialClassValues.has(node.value)
            ) {
              context.report({ node, messageId: "useConstant" });
            }
          },
        };
      },
    },
  },
};
