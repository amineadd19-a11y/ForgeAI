export type PromptCategory = "coding" | "research" | "writing" | "analysis" | "business" | "creative";

export interface PromptTemplate {
  id: string;
  title: string;
  description: string;
  category: PromptCategory;
  template: string;
  tags: string[];
}

/**
 * Curated, original production templates inspired by common prompt-engineering
 * patterns. We intentionally keep a small high-quality catalog instead of
 * importing a huge unreviewed prompt dump into the runtime.
 */
export const PROMPT_LIBRARY: PromptTemplate[] = [
  {
    id: "coding-debugger",
    title: "Production Debugger",
    description: "Diagnose a bug, identify the root cause, and propose the smallest safe fix.",
    category: "coding",
    template: "Act as a senior production engineer. Analyze the issue below.\n\nIssue: {{issue}}\nContext: {{context}}\n\nReturn: (1) root cause, (2) evidence, (3) minimal fix, (4) regression tests, (5) deployment risks. Do not invent missing facts; mark unknowns as NOT VERIFIED.",
    tags: ["debugging", "production", "tests"],
  },
  {
    id: "code-review",
    title: "Strict Code Review",
    description: "Review code for correctness, security, performance, and maintainability.",
    category: "coding",
    template: "Review this code as a principal engineer. Prioritize correctness and security over style.\n\nCode:\n{{code}}\n\nReturn findings by severity: CRITICAL, HIGH, MEDIUM, LOW. For each finding include exact location, why it matters, and a concrete fix. If no issue is verified, say so explicitly.",
    tags: ["review", "security", "quality"],
  },
  {
    id: "research-synthesizer",
    title: "Research Synthesizer",
    description: "Turn multiple sources into a traceable, uncertainty-aware answer.",
    category: "research",
    template: "You are a research analyst. Answer the question using only the supplied evidence.\n\nQuestion: {{question}}\nSources: {{sources}}\n\nSeparate VERIFIED facts from reasonable inferences. Cite the source label next to each material claim. If evidence conflicts, show the conflict instead of silently choosing a side.",
    tags: ["research", "sources", "verification"],
  },
  {
    id: "business-plan",
    title: "Lean Business Plan",
    description: "Convert an idea into a testable business model with measurable assumptions.",
    category: "business",
    template: "Act as a pragmatic startup strategist.\n\nIdea: {{idea}}\nTarget customer: {{customer}}\nBudget: {{budget}}\n\nProduce: value proposition, strongest use case, acquisition channels, pricing hypothesis, key risks, cheapest validation experiment, and 30-day execution plan. Distinguish assumptions from evidence.",
    tags: ["startup", "strategy", "validation"],
  },
  {
    id: "technical-comparison",
    title: "Technical Comparator",
    description: "Compare technologies using explicit criteria rather than generic pros and cons.",
    category: "analysis",
    template: "Compare {{optionA}} and {{optionB}} for this workload: {{workload}}.\n\nScore only on relevant criteria: reliability, performance, cost, complexity, security, ecosystem, and migration risk. Explain each score and finish with a recommendation plus the conditions that would reverse it.",
    tags: ["comparison", "architecture", "decision"],
  },
  {
    id: "requirements-to-spec",
    title: "Requirements to Specification",
    description: "Turn rough product requirements into implementation-ready specifications.",
    category: "analysis",
    template: "Transform these requirements into an implementation specification.\n\nRequirements:\n{{requirements}}\n\nInclude user flows, data model, API contracts, validation rules, edge cases, security requirements, acceptance criteria, and a phased delivery plan. Flag ambiguities as OPEN QUESTIONS instead of guessing.",
    tags: ["product", "spec", "architecture"],
  },
  {
    id: "professional-rewrite",
    title: "Professional Rewrite",
    description: "Rewrite text for clarity while preserving meaning and factual claims.",
    category: "writing",
    template: "Rewrite the text below for {{audience}} in a {{tone}} tone. Preserve all factual claims and important constraints. Remove repetition, vague wording, and unnecessary filler.\n\nText:\n{{text}}\n\nReturn only the improved version.",
    tags: ["rewrite", "clarity", "professional"],
  },
  {
    id: "creative-story",
    title: "Cinematic Story Builder",
    description: "Build a coherent scene with visual beats, tension, and character motivation.",
    category: "creative",
    template: "Write a cinematic scene from this premise: {{premise}}.\n\nGenre: {{genre}}\nLength: {{length}}\n\nPrioritize visual action, subtext, escalating tension, and a memorable ending beat. Avoid exposition dumps and unexplained character decisions.",
    tags: ["story", "cinematic", "screenwriting"],
  },
  {
    id: "data-analysis",
    title: "Decision-Grade Data Analysis",
    description: "Analyze a dataset with explicit assumptions, anomalies, and actionable conclusions.",
    category: "analysis",
    template: "Analyze this dataset for a business decision.\n\nData:\n{{data}}\nDecision to support: {{decision}}\n\nReturn: data-quality issues, key patterns, outliers, quantified findings, limitations, and 3 prioritized actions. Never claim causation from correlation alone.",
    tags: ["data", "analytics", "decision"],
  },
  {
    id: "prompt-improver",
    title: "Prompt Optimizer",
    description: "Improve a prompt without changing the user's intended task.",
    category: "analysis",
    template: "Improve this AI prompt for reliability and useful output.\n\nOriginal prompt:\n{{prompt}}\n\nReturn: optimized prompt, why it is better, missing inputs, and one example of ideal output. Preserve the user's intent; do not add unsupported requirements.",
    tags: ["prompt-engineering", "optimization", "reliability"],
  },
];

export function getPromptTemplate(id: string): PromptTemplate | undefined {
  return PROMPT_LIBRARY.find((prompt) => prompt.id === id);
}

export function renderPromptTemplate(id: string, variables: Record<string, string>): string {
  const prompt = getPromptTemplate(id);
  if (!prompt) throw new Error(`Unknown prompt template: ${id}`);
  return prompt.template.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_, key: string) => variables[key] ?? `{{${key}}}`);
}
