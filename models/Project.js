const mongoose = require('mongoose');
const { marked } = require('marked');
const sanitizeHtml = require('sanitize-html');

const SANITIZE_OPTIONS = {
  allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img']),
  allowedAttributes: { ...sanitizeHtml.defaults.allowedAttributes, '*': ['class'] },
};

const CATEGORIES = [
  'Coding Assistant',
  'CI/CD Automation',
  'Documentation AI',
  'Testing & QA',
  'Security & Compliance',
  'Infrastructure & Ops',
  'Data & Analytics',
  'Developer Tooling',
  'Product Innovation',
  'Other',
];

const AI_TOOLS = [
  'GitHub Copilot',
  'Claude',
  'GPT-4/ChatGPT',
  'Gemini',
  'Mistral',
  'Local LLM (Ollama/etc.)',
  'LangChain',
  'CrewAI',
  'AutoGen',
  'Custom Fine-tuned Model',
  'Other',
];

const CANONICAL_TEAMS = [
  'Ubuntu', 'Juju', 'Launchpad', 'MAAS', 'LXD',
  'Snap/Snapcraft', 'Charmhub', 'Security', 'IS',
  'Kernel', 'Desktop', 'Server', 'Cloud', 'AI/ML', 'Other',
];

const TECH_STACK_DEFAULTS = [
  'Ansible', 'Angular', 'C/C++', 'Django', 'Docker', 'Elasticsearch', 'FastAPI', 'Flask',
  'Go', 'HuggingFace', 'Java', 'JavaScript', 'Kubernetes', 'LangChain', 'LlamaIndex',
  'MongoDB', 'Next.js', 'Node.js', 'PostgreSQL', 'PyTorch', 'Python', 'React', 'Redis',
  'Ruby', 'Rust', 'Shell/Bash', 'TensorFlow', 'Terraform', 'TypeScript', 'Vue',
];

const COMPLETION_STAGES = ['concept', 'prototype', 'mvp', 'polished'];

const projectSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    slug: { type: String, unique: true, lowercase: true },
    description: { type: String, default: '' },
    category: { type: String, enum: CATEGORIES, required: true },
    status: { type: String, enum: ['draft', 'submitted', 'finalist'], default: 'draft' },

    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    team: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    canonicalTeam: { type: String, default: null },

    logo: String,
    repoLinks: [String],
    demoUrl: String,
    slidesUrl: String,
    externalLinks: [{ label: String, url: String }],

    aiTools: [String],
    techStack: [String],
    completionStage: { type: String, enum: COMPLETION_STAGES, default: 'prototype' },

    asciinema: [{ castId: String, title: String }],
    videos: [{ url: String, title: String, type: { type: String, enum: ['youtube', 'vimeo'] } }],

    avgRating: { type: Number, default: 0 },
    voteCount: { type: Number, default: 0 },

    // GitHub stats cache
    githubStats: [{
      repoUrl: String,
      stars: Number,
      lastCommit: Date,
      openPRs: Number,
      fetchedAt: Date,
    }],
  },
  { timestamps: true },
);

// Auto-generate slug from title
projectSchema.pre('save', async function generateSlug() {
  if (!this.isModified('title') && this.slug) return;
  let base = this.title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 60);
  if (!base) base = `project-${Date.now()}`;
  let slug = base;
  let counter = 1;
  const MAX_SLUG_ATTEMPTS = 50;
  while (counter <= MAX_SLUG_ATTEMPTS && await mongoose.model('Project').findOne({ slug, _id: { $ne: this._id } })) {
    slug = `${base}-${counter++}`;
  }
  if (counter > MAX_SLUG_ATTEMPTS) slug = `${base}-${Date.now()}`;
  this.slug = slug;
});

// Virtual: sanitized HTML from markdown description
projectSchema.virtual('descriptionHtml').get(function () {
  return sanitizeHtml(marked(this.description || ''), SANITIZE_OPTIONS);
});

// Virtual: liveliness score 0-1 based on most recent GitHub commit
projectSchema.virtual('liveliness').get(function () {
  if (!this.githubStats || !this.githubStats.length) return 0;
  const now = Date.now();
  const mostRecent = Math.max(...this.githubStats.map((s) => (s.lastCommit ? new Date(s.lastCommit).getTime() : 0)));
  if (!mostRecent) return 0;
  const daysSince = (now - mostRecent) / (1000 * 60 * 60 * 24);
  return Math.max(0, 1 - daysSince / 7); // full glow within 1 day, zero at 7 days
});

projectSchema.set('toJSON', { virtuals: true });
projectSchema.set('toObject', { virtuals: true });

const Project = mongoose.model('Project', projectSchema);

/** Compute liveliness on plain lean objects (mirrors the virtual). */
function computeLiveliness(project) {
  if (!project.githubStats?.length) return 0;
  const now = Date.now();
  const mostRecent = Math.max(...project.githubStats.map((s) => (s.lastCommit ? new Date(s.lastCommit).getTime() : 0)));
  if (!mostRecent) return 0;
  const daysSince = (now - mostRecent) / (1000 * 60 * 60 * 24);
  return Math.max(0, 1 - daysSince / 7);
}

module.exports = { Project, CATEGORIES, AI_TOOLS, CANONICAL_TEAMS, TECH_STACK_DEFAULTS, COMPLETION_STAGES, computeLiveliness };
