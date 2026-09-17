const credentialClassValues = new Set(["connector-key", "serve-token"]);

// A disable directive: `oxlint-disable`, `oxlint-disable-next-line`,
// `oxlint-disable-line` (and the eslint- spellings oxlint also honors).
// Group 1 is everything after the directive keyword.
const disableDirective =
  /^\s*(?:oxlint|eslint)-disable(?:-next-line|-line)?\b(.*)$/s;

export function parseDisableDirective(commentValue) {
  const match = disableDirective.exec(commentValue);
  if (!match) return undefined;

  // Oxlint treats the first `--` as the reason delimiter even without spaces.
  // Retain that grammar when identifying the rule tokens, while separately
  // enforcing the repository's readable ` -- ` separator convention below.
  const separatorIndex = match[1].indexOf("--");
  const rulesPart =
    separatorIndex === -1 ? match[1] : match[1].slice(0, separatorIndex);
  const reason =
    separatorIndex === -1 ? "" : match[1].slice(separatorIndex + 2).trim();
  const hasSpacedSeparator =
    separatorIndex > 0 &&
    /\s/u.test(match[1][separatorIndex - 1]) &&
    separatorIndex + 2 < match[1].length &&
    /\s/u.test(match[1][separatorIndex + 2]);
  const rules = rulesPart
    .trim()
    .split(/[\s,]+/u)
    .filter(Boolean);

  return { rules, reason, hasSpacedSeparator };
}

export default {
  meta: {
    name: "dashframe",
  },
  rules: {
    "require-disable-reason": {
      meta: {
        type: "problem",
        docs: {
          description:
            "Require every lint disable directive to name the rules it silences and give a reason after ` -- `.",
        },
        messages: {
          missingRules:
            "A bare disable directive silences every rule. Name the rule(s) being disabled.",
          missingReason:
            "Say why this rule is disabled here: `oxlint-disable-next-line <rule> -- <reason>`.",
        },
      },
      create(context) {
        return {
          Program() {
            for (const comment of context.sourceCode.getAllComments()) {
              const directive = parseDisableDirective(comment.value);
              if (!directive) continue;
              if (directive.rules.length === 0) {
                context.report({ node: comment, messageId: "missingRules" });
                continue;
              }
              if (directive.reason === "" || !directive.hasSpacedSeparator) {
                context.report({ node: comment, messageId: "missingReason" });
              }
            }
          },
        };
      },
    },
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
