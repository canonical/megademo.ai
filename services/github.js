/**
 * GitHub stats fetcher — retrieves repo stats and caches them 1h in MongoDB
 */
const axios = require('axios');
const { Project } = require('../models/Project');

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

function extractRepoPath(url) {
  const match = url.match(/github\.com\/([^/]+\/[^/]+?)(?:\.git)?(?:\/?$|\/.*$)/);
  return match ? match[1] : null;
}

function parseVideoId(url) {
  const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  if (yt) return { type: 'youtube', id: yt[1] };
  const vm = url.match(/vimeo\.com\/(\d+)/);
  if (vm) return { type: 'vimeo', id: vm[1] };
  return null;
}

async function fetchRepoStats(repoPath) {
  const headers = { Accept: 'application/vnd.github.v3+json' };
  // GitHub token for repo stats (increases rate limit from 60 to 5000 req/hr)
  // Using a dedicated GITHUB_TOKEN env var (not the user's OAuth token)
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

  const config = { headers, timeout: 10000 };

  const [repoRes, prsRes] = await Promise.all([
    axios.get(`https://api.github.com/repos/${repoPath}`, config),
    axios.get(`https://api.github.com/repos/${repoPath}/pulls?state=open&per_page=1`, config),
  ]);

  const lastCommit = repoRes.data.pushed_at ? new Date(repoRes.data.pushed_at) : null;
  return {
    stars:      repoRes.data.stargazers_count || 0,
    lastCommit,
    openPRs:    prsRes.headers['link']?.includes('rel="last"')
                  ? parseInt(prsRes.headers['link'].match(/page=(\d+)>; rel="last"/)?.[1] || '0', 10)
                  : prsRes.data.length,
    fetchedAt:  new Date(),
  };
}

/**
 * Refresh GitHub stats for a project if cache is stale
 */
async function refreshProjectStats(projectId) {
  const project = await Project.findById(projectId);
  if (!project) return null;

  const now = Date.now();
  const updatedStats = [];

  for (const repoUrl of project.repoLinks || []) {
    const repoPath = extractRepoPath(repoUrl);
    if (!repoPath) continue;

    const existing = project.githubStats?.find((s) => s.repoUrl === repoUrl);
    if (existing && existing.fetchedAt && now - existing.fetchedAt.getTime() < CACHE_TTL_MS) {
      updatedStats.push(existing);
      continue;
    }

    try {
      const stats = await fetchRepoStats(repoPath);
      updatedStats.push({ repoUrl, ...stats });
    } catch (err) {
      console.error(`GitHub stats fetch failed for ${repoPath}:`, err.message);
      if (existing) updatedStats.push(existing);
    }
  }

  project.githubStats = updatedStats;
  await project.save();
  return project;
}

module.exports = { refreshProjectStats, parseVideoId };
