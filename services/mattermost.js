/**
 * Mattermost webhook integration
 */
const axios = require('axios');
const Settings = require('../models/Settings');

/** Escape markdown special chars in user-supplied content for Mattermost webhooks */
function esc(str) {
  if (!str) return '';
  return String(str).replace(/\\/g, '\\\\').replace(/[*_~`[\]|>#]/g, '\\$&');
}
const CATEGORY_ICON = {
  'Coding Assistant':      ':computer:',
  'CI/CD Automation':      ':rocket:',
  'Documentation AI':      ':memo:',
  'Testing & QA':          ':white_check_mark:',
  'Security & Compliance': ':lock:',
  'Infrastructure & Ops':  ':wrench:',
  'Data & Analytics':      ':bar_chart:',
  'Developer Tooling':     ':hammer_and_wrench:',
  'Product Innovation':    ':bulb:',
  'Other':                 ':star:',
};

async function getWebhookUrl() {
  return process.env.MATTERMOST_WEBHOOK_URL || await Settings.get('mattermostWebhook');
}

async function post(text) {
  const webhookUrl = await getWebhookUrl();
  if (!webhookUrl) return;
  try {
    await axios.post(webhookUrl, { text }, { timeout: 5000 });
  } catch (err) {
    console.error('Mattermost webhook failed:', err.message);
  }
}

/**
 * Fired when a participant submits a project for the first time.
 */
async function notifyProjectSubmitted(project, baseUrl) {
  const icon = CATEGORY_ICON[project.category] || ':star:';
  const url  = `${baseUrl}/projects/${project.slug}`;
  const desc = project.description
    ? `> ${project.description.substring(0, 200)}${project.description.length > 200 ? '…' : ''}`
    : '';

  await post([
    `## ${icon} New project submitted: **[${esc(project.title)}](${url})**`,
    `**Category:** ${project.category}   |   **Team:** ${esc(project.canonicalTeam)}`,
    `**AI tools:** ${project.aiTools?.map(esc).join(', ') || 'Not specified'}`,
    desc,
  ].filter(Boolean).join('\n'));
}

/**
 * Fired when an admin promotes a project to finalist.
 */
async function notifyFinalistPromoted(project, baseUrl) {
  const icon = CATEGORY_ICON[project.category] || ':star:';
  const url  = `${baseUrl}/projects/${project.slug}`;
  const rating = project.avgRating != null ? `⭐ ${Number(project.avgRating).toFixed(1)}/5` : 'No votes yet';

  await post([
    `## 🏆 Finalist announced: **[${esc(project.title)}](${url})**`,
    `${icon} **Category:** ${project.category}   |   **Team:** ${esc(project.canonicalTeam)}`,
    `**Rating:** ${rating} (${project.voteCount || 0} votes)`,
    `Congratulations to the team! 🎉`,
  ].join('\n'));
}

// In-memory accumulator for voting milestones — flushed each hourly summary.
const _pendingMilestones = [];

/**
 * Record a voting milestone to be included in the next hourly summary.
 * Replaces the old real-time notification.
 */
function recordVotingMilestone(project, milestone, baseUrl) {
  const url = `${baseUrl}/projects/${project.slug}`;
  _pendingMilestones.push({
    title:     esc(project.title),
    url,
    milestone,
    avgRating: project.avgRating,
  });
}

/**
 * Hourly stats summary — called every hour on the hour by the cron scheduler.
 * Includes any voting milestones accumulated since the last summary.
 * @param {object} stats - { finalists, teams, votes, topProjects }
 */
async function postHourlySummary({ finalists, teams, votes, topProjects }) {
  const medal = ['🥇', '🥈', '🥉'];
  const topLines = topProjects.length
    ? topProjects.map((p, i) =>
        `${medal[i] || `${i + 1}.`} **[${esc(p.title)}](${p.url})** — ⭐ ${p.avgRating != null ? Number(p.avgRating).toFixed(1) : '—'} (${p.voteCount ?? 0} votes)`
      ).join('\n')
    : '_No votes yet — be the first!_';

  // Drain pending milestones
  const milestones = _pendingMilestones.splice(0);
  const milestoneLines = milestones.length
    ? [
        ``,
        `**🎯 Voting milestones since last update:**`,
        ...milestones.map((m) => {
          const rating = m.avgRating != null ? Number(m.avgRating).toFixed(1) : '—';
          return `⭐ **[${m.title}](${m.url})** hit **${m.milestone} votes** (⭐ ${rating}/5)`;
        }),
      ]
    : [];

  await post([
    `## 📊 MegaDemo.ai — Hourly Update`,
    `| | |`,
    `|---|---|`,
    `| 🏢 Teams represented | **${teams}** |`,
    `| ⭐ Total votes cast | **${votes}** |`,
    `| 🏆 Finalists | **${finalists}** |`,
    ...milestoneLines,
    ``,
    `**Top projects right now:**`,
    topLines,
  ].join('\n'));
}

module.exports = {
  notifyProjectSubmitted,
  notifyFinalistPromoted,
  recordVotingMilestone,
  postHourlySummary,
};
