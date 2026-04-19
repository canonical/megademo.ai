/**
 * Mattermost webhook integration
 */
const axios = require('axios');
const Settings = require('../models/Settings');

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
    `## ${icon} New project submitted: **[${project.title}](${url})**`,
    `**Category:** ${project.category}   |   **Team:** ${project.canonicalTeam}`,
    `**AI tools:** ${project.aiTools?.join(', ') || 'Not specified'}`,
    desc,
  ].filter(Boolean).join('\n'));
}

/**
 * Fired when an admin promotes a project to finalist.
 */
async function notifyFinalistPromoted(project, baseUrl) {
  const icon = CATEGORY_ICON[project.category] || ':star:';
  const url  = `${baseUrl}/projects/${project.slug}`;
  const rating = project.avgRating ? `⭐ ${project.avgRating.toFixed(1)}/5` : 'No votes yet';

  await post([
    `## 🏆 Finalist announced: **[${project.title}](${url})**`,
    `${icon} **Category:** ${project.category}   |   **Team:** ${project.canonicalTeam}`,
    `**Rating:** ${rating} (${project.voteCount || 0} votes)`,
    `Congratulations to the team! 🎉`,
  ].join('\n'));
}

/**
 * Fired when a project crosses a vote-count milestone (5, 10, 25, 50 …).
 */
async function notifyVotingMilestone(project, milestone, baseUrl) {
  const url    = `${baseUrl}/projects/${project.slug}`;
  const rating = project.avgRating ? project.avgRating.toFixed(1) : '—';

  await post([
    `## ⭐ Voting milestone: **[${project.title}](${url})** just hit **${milestone} votes!**`,
    `Current rating: ⭐ ${rating}/5 — go vote if you haven't!`,
  ].join('\n'));
}

/**
 * Daily stats summary — called 3× per day by the cron scheduler.
 * @param {object} stats - { projects, submitted, finalists, teams, votes, topProjects }
 */
async function postDailySummary({ projects, submitted, finalists, teams, votes, topProjects }) {
  const medal = ['🥇', '🥈', '🥉'];
  const topLines = topProjects.length
    ? topProjects.map((p, i) =>
        `${medal[i] || `${i + 1}.`} **[${p.title}](${p.url})** — ⭐ ${p.avgRating != null ? Number(p.avgRating).toFixed(1) : '—'} (${p.voteCount ?? 0} votes)`
      ).join('\n')
    : '_No votes yet — be the first!_';

  await post([
    `## 📊 MegaDemo.ai — Daily Snapshot`,
    `| | |`,
    `|---|---|`,
    `| 🏢 Teams represented | **${teams}** |`,
    `| 📁 Projects registered | **${projects}** |`,
    `| ✅ Submitted | **${submitted}** |`,
    `| 🏆 Finalists | **${finalists}** |`,
    `| ⭐ Total votes cast | **${votes}** |`,
    ``,
    `**Top projects right now:**`,
    topLines,
  ].join('\n'));
}

module.exports = {
  notifyProjectSubmitted,
  notifyFinalistPromoted,
  notifyVotingMilestone,
  postDailySummary,
};
