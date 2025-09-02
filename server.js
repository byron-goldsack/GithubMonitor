const express = require('express');
const fetch = require('node-fetch');
const path = require('path');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// GitHub API configuration
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_USERNAME = process.env.GITHUB_USERNAME;
const REPOSITORIES = process.env.REPOSITORIES ? process.env.REPOSITORIES.split(',') : [];

if (!GITHUB_TOKEN || !GITHUB_USERNAME) {
    console.error('Please set GITHUB_TOKEN and GITHUB_USERNAME in your .env file');
    process.exit(1);
}

// GitHub API helper
async function githubRequest(url) {
    console.log(`Making GitHub API request to: ${url}`);
    
    // Handle both classic and fine-grained personal access tokens
    const authHeader = GITHUB_TOKEN.startsWith('github_pat_') 
        ? `Bearer ${GITHUB_TOKEN}` 
        : `token ${GITHUB_TOKEN}`;
    
    const response = await fetch(url, {
        headers: {
            'Authorization': authHeader,
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'GitHub-Monitor'
        }
    });
    
    if (!response.ok) {
        console.error(`GitHub API error for ${url}: ${response.status} ${response.statusText}`);
        const errorText = await response.text();
        console.error(`Error details: ${errorText}`);
        throw new Error(`GitHub API error: ${response.status} ${response.statusText} - ${errorText}`);
    }
    
    return response.json();
}

// Get PR reviews and requested reviewers
async function getPRReviews(owner, repo, prNumber) {
    try {
        const [reviews, requestedReviewers] = await Promise.all([
            githubRequest(`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/reviews`),
            githubRequest(`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/requested_reviewers`)
        ]);
        
        console.log(`PR ${prNumber} - Requested reviewers:`, JSON.stringify(requestedReviewers, null, 2));
        
        const approving = reviews.filter(review => review.state === 'APPROVED').map(review => ({
            user: review.user.login,
            submitted_at: review.submitted_at,
            author_association: review.author_association
        }));
        
        const changesRequested = reviews.filter(review => review.state === 'CHANGES_REQUESTED').map(review => ({
            user: review.user.login,
            submitted_at: review.submitted_at,
            author_association: review.author_association
        }));
        
        const pending = reviews.filter(review => review.state === 'PENDING').map(review => ({
            user: review.user.login,
            submitted_at: review.submitted_at,
            author_association: review.author_association
        }));
        
        // Get requested users and teams (still pending review)
        const requestedUsers = requestedReviewers.users || [];
        const requestedTeams = requestedReviewers.teams || [];
        
        const result = { 
            approving, 
            changesRequested, 
            pending,
            requestedUsers: requestedUsers.map(user => ({
                user: user.login,
                type: 'user'
            })),
            requestedTeams: requestedTeams.map(team => ({
                team: team.slug,
                name: team.name,
                type: 'team'
            }))
        };
        
        console.log(`PR ${prNumber} - Final result:`, JSON.stringify(result, null, 2));
        
        return result;
    } catch (error) {
        console.error(`Error fetching reviews for PR ${prNumber}:`, error.message);
        return { 
            approving: [], 
            changesRequested: [], 
            pending: [],
            requestedUsers: [],
            requestedTeams: []
        };
    }
}

// Get PR comments to find the most recent one
async function getLatestPRComment(owner, repo, prNumber) {
    try {
        const [issueComments, reviewComments] = await Promise.all([
            githubRequest(`https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/comments`),
            githubRequest(`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/comments`)
        ]);
        
        const allComments = [...issueComments, ...reviewComments];
        
        if (allComments.length === 0) return null;
        
        // Sort by created_at and get the most recent
        allComments.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        return allComments[0].created_at;
    } catch (error) {
        console.error(`Error fetching comments for PR ${prNumber}:`, error.message);
        return null;
    }
}

// Get workflow runs for a PR
async function getPRWorkflows(owner, repo, prNumber, headSha) {
    try {
        const workflows = await githubRequest(`https://api.github.com/repos/${owner}/${repo}/actions/runs?head_sha=${headSha}`);
        
        return workflows.workflow_runs.map(run => ({
            id: run.id,
            name: run.name,
            status: run.status,
            conclusion: run.conclusion,
            created_at: run.created_at,
            updated_at: run.updated_at,
            html_url: run.html_url
        }));
    } catch (error) {
        console.error(`Error fetching workflows for PR ${prNumber}:`, error.message);
        return [];
    }
}

// Get user's triggered workflow runs that aren't associated with PRs
async function getUserWorkflows() {
    const allRuns = [];
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    
    for (const repo of REPOSITORIES) {
        const [owner, repoName] = repo.split('/');
        try {
            const workflows = await githubRequest(`https://api.github.com/repos/${owner}/${repoName}/actions/runs?actor=${GITHUB_USERNAME}&per_page=50`);
            
            for (const run of workflows.workflow_runs) {
                const runDate = new Date(run.created_at);
                
                // Skip if older than 3 days
                if (runDate < threeDaysAgo) {
                    continue;
                }
                
                // Skip if it's a pull request branch (refs/pull/*)
                if (run.head_branch && run.head_branch.startsWith('refs/pull/')) {
                    continue;
                }
                
                // Check if this run is associated with a PR
                const associatedPRs = run.pull_requests || [];
                
                if (associatedPRs.length === 0) {
                    allRuns.push({
                        id: run.id,
                        name: run.name,
                        repository: repo,
                        status: run.status,
                        conclusion: run.conclusion,
                        created_at: run.created_at,
                        updated_at: run.updated_at,
                        html_url: run.html_url,
                        head_branch: run.head_branch,
                        head_sha: run.head_sha?.substring(0, 7)
                    });
                }
            }
        } catch (error) {
            console.error(`Error fetching workflows for ${repo}:`, error.message);
        }
    }
    
    // Sort by created_at (most recent first)
    return allRuns.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

// API Routes
app.get('/api/prs', async (req, res) => {
    try {
        const allPRs = [];
        
        for (const repo of REPOSITORIES) {
            const [owner, repoName] = repo.split('/');
            
            try {
                // Get open PRs (we'll filter by author afterwards)
                const prs = await githubRequest(`https://api.github.com/repos/${owner}/${repoName}/pulls?state=open`);
                
                // Filter to only include PRs authored by the user
                const userPRs = prs.filter(pr => pr.user.login === GITHUB_USERNAME);
                
                for (const pr of userPRs) {
                    const [reviews, latestComment, workflows] = await Promise.all([
                        getPRReviews(owner, repoName, pr.number),
                        getLatestPRComment(owner, repoName, pr.number),
                        getPRWorkflows(owner, repoName, pr.number, pr.head.sha)
                    ]);
                    
                    allPRs.push({
                        id: pr.id,
                        number: pr.number,
                        title: pr.title,
                        repository: repo,
                        html_url: pr.html_url,
                        head_branch: pr.head.ref,
                        base_branch: pr.base.ref,
                        created_at: pr.created_at,
                        updated_at: pr.updated_at,
                        author: pr.user.login,
                        draft: pr.draft,
                        mergeable: pr.mergeable,
                        reviews,
                        latest_comment: latestComment,
                        workflows
                    });
                }
            } catch (error) {
                console.error(`Error fetching PRs for ${repo}:`, error.message);
            }
        }
        
        // Sort by created_at (most recent first)
        allPRs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        
        res.json(allPRs);
    } catch (error) {
        console.error('Error fetching PRs:', error);
        res.status(500).json({ error: 'Failed to fetch PRs' });
    }
});

app.get('/api/workflows', async (req, res) => {
    try {
        const workflows = await getUserWorkflows();
        res.json(workflows);
    } catch (error) {
        console.error('Error fetching workflows:', error);
        res.status(500).json({ error: 'Failed to fetch workflows' });
    }
});

app.get('/api/config', (req, res) => {
    res.json({
        username: GITHUB_USERNAME,
        repositories: REPOSITORIES
    });
});

// Debug endpoint to test data
app.get('/api/debug', async (req, res) => {
    try {
        const reviews = await getPRReviews('aderant', 'expert-suite', 119);
        res.json(reviews);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Serve the main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`GitHub Monitor running on http://localhost:${PORT}`);
    console.log(`Monitoring repositories: ${REPOSITORIES.join(', ')}`);
});
