class GitHubMonitor {
    constructor() {
        this.repositories = [];
        this.init();
    }

    async init() {
        this.setupEventListeners();
        await this.loadConfig();
        await this.loadData();
    }

    setupEventListeners() {
        // Refresh button
        document.getElementById('refreshBtn').addEventListener('click', () => {
            this.loadData();
        });

        // Auto-refresh every 5 minutes
        setInterval(() => {
            this.loadData();
        }, 5 * 60 * 1000);
    }

    async loadConfig() {
        try {
            const response = await fetch('/api/config');
            const config = await response.json();
            document.querySelector('.username').textContent = `@${config.username}`;
            this.repositories = config.repositories;
        } catch (error) {
            console.error('Error loading config:', error);
        }
    }

    async loadData() {
        this.showLoading(true);
        
        try {
            const [prsResponse, workflowsResponse] = await Promise.all([
                fetch('/api/prs'),
                fetch('/api/workflows')
            ]);

            if (!prsResponse.ok || !workflowsResponse.ok) {
                throw new Error('Failed to fetch data');
            }

            const prs = await prsResponse.json();
            const workflows = await workflowsResponse.json();

            // Clear loading state and render data
            this.showLoading(false);
            this.renderPRs(prs);
            this.renderWorkflows(workflows);
        } catch (error) {
            console.error('Error loading data:', error);
            this.showError('Failed to load data. Please check your configuration and try again.');
        }
    }

    showLoading(show) {
        const refreshBtn = document.getElementById('refreshBtn');
        
        refreshBtn.disabled = show;
        refreshBtn.textContent = show ? '⏳ Loading...' : '🔄 Refresh';
    }

    showError(message) {
        const prsContainer = document.getElementById('prs-container');
        const workflowsContainer = document.getElementById('workflows-container');
        prsContainer.innerHTML = `<div class="error-message">${message}</div>`;
        workflowsContainer.innerHTML = `<div class="error-message">${message}</div>`;
    }

    renderPRs(prs) {
        const container = document.getElementById('prs-container');
        
        if (prs.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <h3>No open pull requests</h3>
                    <p>All caught up! 🎉</p>
                </div>
            `;
            return;
        }

        container.innerHTML = prs.map(pr => this.createPRCard(pr)).join('');
    }

    createPRCard(pr) {
        const latestCommentText = pr.latest_comment 
            ? `<div class="latest-comment"><strong>Last activity:</strong> ${this.formatDate(pr.latest_comment)}</div>`
            : '';

        const draftBadge = pr.draft ? '<span class="draft-badge">DRAFT</span>' : '';
        
        // Get repository-based color class
        const repoIndex = this.repositories.indexOf(pr.repository) + 1;
        const repoClass = `repo-${Math.min(repoIndex, 8)}`; // Limit to 8 colors
        
        // Add draft class if it's a draft PR
        const draftClass = pr.draft ? 'draft' : '';
        const titleClasses = `pr-title ${repoClass} ${draftClass}`.trim();
        
        // Get branch type classes
        const headBranchClass = this.getBranchClass(pr.head_branch);
        const baseBranchClass = this.getBranchClass(pr.base_branch);

        return `
            <div class="pr-card">
                <div class="pr-header">
                    <div>
                        <a href="${pr.html_url}" target="_blank" class="${titleClasses}">
                            #${pr.number} ${pr.title}${draftBadge}
                        </a>
                        <div class="pr-meta">
                            <span class="repository">${pr.repository}</span>
                            by ${pr.author} • ${this.formatDate(pr.created_at)}
                        </div>
                    </div>
                </div>

                <div class="branch-info">
                    <span class="branch ${headBranchClass}">${pr.head_branch}</span>
                    →
                    <span class="branch base-branch ${baseBranchClass}">${pr.base_branch}</span>
                </div>

                <div class="reviews-section">
                    <div class="review-group approving">
                        <h4>✅ Approved (${pr.reviews.approving.length})</h4>
                        <ul class="review-list">
                            ${pr.reviews.approving.map(review => 
                                `<li>@${review.user}${review.author_association ? ` (${review.author_association})` : ''} on ${this.formatDate(review.submitted_at)}</li>`
                            ).join('')}
                        </ul>
                    </div>

                    ${pr.reviews.changesRequested.length > 0 ? `
                    <div class="review-group changes-requested">
                        <h4>❌ Changes Requested (${pr.reviews.changesRequested.length})</h4>
                        <ul class="review-list">
                            ${pr.reviews.changesRequested.map(review => 
                                `<li>@${review.user}${review.author_association ? ` (${review.author_association})` : ''} on ${this.formatDate(review.submitted_at)}</li>`
                            ).join('')}
                        </ul>
                    </div>
                    ` : ''}

                    <div class="review-group requested">
                        <h4>🔍 Awaiting Review (${pr.reviews.requestedUsers.length + pr.reviews.requestedTeams.length})</h4>
                        <ul class="review-list">
                            ${pr.reviews.requestedUsers.map(request => 
                                `<li class="requested-user">👤 @${request.user}</li>`
                            ).join('')}
                            ${pr.reviews.requestedTeams.map(request => 
                                `<li class="requested-team">👥 @${request.team} (${request.name})</li>`
                            ).join('')}
                        </ul>
                    </div>
                </div>

                ${pr.workflows.length > 0 ? `
                    <div class="workflows-section">
                        <h4>Workflows</h4>
                        <div class="workflow-list">
                            ${pr.workflows.map(workflow => this.createWorkflowItem(workflow)).join('')}
                        </div>
                    </div>
                ` : ''}

                ${latestCommentText}
            </div>
        `;
    }

    renderWorkflows(workflows) {
        const container = document.getElementById('workflows-container');
        
        if (workflows.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <h3>No standalone workflow runs</h3>
                    <p>No recent workflow runs found that aren't associated with pull requests.</p>
                </div>
            `;
            return;
        }

        container.innerHTML = workflows.map(workflow => this.createWorkflowCard(workflow)).join('');
    }

    createWorkflowCard(workflow) {
        return `
            <div class="workflow-card">
                <div class="workflow-header">
                    <div>
                        <a href="${workflow.html_url}" target="_blank" class="workflow-title">
                            ${workflow.name}
                        </a>
                        <div class="workflow-meta">
                            <span class="repository">${workflow.repository}</span>
                            • ${this.formatDate(workflow.created_at)}
                        </div>
                    </div>
                    <div class="status-info">
                        ${this.getStatusIcon(workflow.status, workflow.conclusion)}
                        ${this.getStatusText(workflow.status, workflow.conclusion)}
                    </div>
                </div>

                <div class="branch-info">
                    Branch: <span class="branch">${workflow.head_branch}</span>
                    ${workflow.head_sha ? `• SHA: <code>${workflow.head_sha}</code>` : ''}
                </div>
            </div>
        `;
    }

    createWorkflowItem(workflow) {
        return `
            <a href="${workflow.html_url}" target="_blank" class="workflow-item">
                ${this.getStatusIcon(workflow.status, workflow.conclusion)}
                ${workflow.name}
            </a>
        `;
    }

    getStatusIcon(status, conclusion) {
        if (status === 'in_progress' || status === 'queued') {
            return '<span class="status-icon status-in_progress"></span>';
        }
        
        if (status === 'completed') {
            switch (conclusion) {
                case 'success':
                    return '<span class="status-icon status-success"></span>';
                case 'failure':
                case 'timed_out':
                    return '<span class="status-icon status-failure"></span>';
                case 'cancelled':
                    return '<span class="status-icon status-cancelled"></span>';
                default:
                    return '<span class="status-icon status-pending"></span>';
            }
        }
        
        return '<span class="status-icon status-pending"></span>';
    }

    getStatusText(status, conclusion) {
        if (status === 'in_progress') return 'In Progress';
        if (status === 'queued') return 'Queued';
        
        if (status === 'completed') {
            switch (conclusion) {
                case 'success': return 'Success';
                case 'failure': return 'Failed';
                case 'cancelled': return 'Cancelled';
                case 'timed_out': return 'Timed Out';
                default: return 'Completed';
            }
        }
        
        return status.charAt(0).toUpperCase() + status.slice(1);
    }

    getBranchClass(branchName) {
        if (branchName === 'master' || branchName === 'main') {
            return 'master-branch';
        }
        return 'feature-branch';
    }

    formatDate(dateString) {
        const date = new Date(dateString);
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);

        if (diffMins < 1) return 'just now';
        if (diffMins < 60) return `${diffMins}m ago`;
        if (diffHours < 24) return `${diffHours}h ago`;
        if (diffDays < 7) return `${diffDays}d ago`;
        
        return date.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
        });
    }
}

// Initialize the app when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new GitHubMonitor();
});
