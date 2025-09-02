# GitHub Monitor

A web-based tool to monitor GitHub pull requests and workflows across multiple repositories.

## Features

- Monitor open PRs across multiple repositories
- View PR details including head/base branches, reviews, and status
- Track workflow runs and their status
- Real-time updates on PR activity
- Clean web interface

## Setup

1. Clone this repository
2. Install dependencies: `npm install`
3. Create a `.env` file with your GitHub configuration:
   ```
   GITHUB_TOKEN=your_github_personal_access_token
   GITHUB_USERNAME=your_github_username
   REPOSITORIES=owner1/repo1,owner2/repo2,owner3/repo3,owner4/repo4,owner5/repo5
   PORT=3000
   ```
4. Start the server: `npm start` or `npm run dev` for development

## Environment Variables

- `GITHUB_TOKEN`: Your GitHub Personal Access Token with repo access
- `GITHUB_USERNAME`: Your GitHub username
- `REPOSITORIES`: Comma-separated list of repositories to monitor (format: owner/repo)
- `PORT`: Port to run the server on (default: 3000)

## Usage

1. Start the server
2. Open your browser to `http://localhost:3000`
3. View your PRs and workflow status

## Getting a GitHub Token

1. Go to GitHub Settings > Developer settings > Personal access tokens
2. Generate a new token with the following scopes:
   - `repo` (Full control of private repositories)
   - `workflow` (Update GitHub Action workflows)
