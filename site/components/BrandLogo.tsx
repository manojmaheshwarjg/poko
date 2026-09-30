/* The real logos of the tools the page mentions, served from /logos (Simple Icons and
   Lobe Icons). One-color logos render grey so rows stay quiet; `plain` keeps them at
   full strength next to colored ones. The logos belong to their owners. */
const LOGOS = {
  claude: ['claude-color', 'Claude', false],
  chatgpt: ['openai', 'ChatGPT', true],
  openai: ['openai', 'OpenAI', true],
  anthropic: ['claude-color', 'Anthropic', false],
  comet: ['perplexity-color', 'Comet by Perplexity', false],
  gemini: ['gemini-color', 'Gemini', false],
  copilot: ['copilot-color', 'Microsoft Copilot', false],
  mistral: ['mistral-color', 'Mistral', false],
  groq: ['groq', 'Groq', true],
  ollama: ['ollama', 'Ollama', true],
  lmstudio: ['lmstudio', 'LM Studio', true],
  notion: ['notion', 'Notion', true],
  confluence: ['confluence', 'Confluence', true],
  zendesk: ['zendesk', 'Zendesk', true],
  intercom: ['intercom', 'Intercom', true],
  gitbook: ['gitbook', 'GitBook', true],
  react: ['react', 'React', true],
  nextjs: ['nextdotjs', 'Next.js', true],
  vue: ['vuedotjs', 'Vue', true],
  angular: ['angular', 'Angular', true],
  svelte: ['svelte', 'Svelte', true],
  html: ['html5', 'Plain HTML', true],
} as const;

export type LogoName = keyof typeof LOGOS;

export function logoLabel(name: LogoName) {
  return LOGOS[name][1];
}

export function BrandLogo({ name, size = 16, plain = false }: { name: LogoName; size?: number; plain?: boolean }) {
  const [file, label, mono] = LOGOS[name];
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={`brand-logo${mono && !plain ? ' mono' : ''}`}
      data-mono={mono || undefined}
      src={`/logos/${file}.svg`}
      alt={label}
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
    />
  );
}
