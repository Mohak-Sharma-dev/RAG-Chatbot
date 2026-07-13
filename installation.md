# Local Installation & Deployment Guide

## Prerequisites
- Node.js (version 14+) installed
- npm (Node Package Manager) installed
- Basic familiarity with terminal/command line

## Installation Steps
1. Clone repository
   ```git clone https://github.com/your-repo-url.git```
2. Navigate to project directory
   ```cd Chatbot-website```
3. Install dependencies
   ```npm install```
4. Set environment variables (if required)
   ```export NODE_ENV=development```

## Running Locally
- Start development server
   ```npm run dev```
- Visit http://localhost:3000 in browser

## Deployment Options
### Backend Deployment
- Run backend server:
   ```python RAGChatbotcopy.py```
   (Access at http://localhost:8000)

### Frontend Deployment
- Build frontend:
   ```npm run build```
- Serve frontend files:
   ```python -m http.server 3000```
   (Access at http://localhost:3000)

### Cloud Deployment
- Netlify: Drag & drop project folder
- Vercel: Deploy via GitHub integration
- AWS S3: Manual upload of build folder

## Maintenance
- Update dependencies: ```npm update```
- Check for breaking changes in README.md