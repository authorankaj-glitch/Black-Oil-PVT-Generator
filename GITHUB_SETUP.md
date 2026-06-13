# Pushing to GitHub

## Steps to push your Scientific Calculator to GitHub:

### 1. Create the Repository on GitHub
- Go to https://github.com/new
- Repository name: **P1-Calculator**
- Description: Scientific calculator with GUI and CLI modes
- Choose Public or Private
- Do NOT initialize with README (we already have one)
- Click "Create repository"

### 2. Add Remote and Push
After creating the repository, run these commands:

```bash
cd ~/Projects/scientific-calculator

# Add the remote (replace YOUR_USERNAME with your actual GitHub username)
git remote add origin https://github.com/authorankaj-glitch/P1-Calculator.git

# Rename branch to main if needed
git branch -M main

# Push to GitHub
git push -u origin main
```

### 3. Verify
- Visit: https://github.com/authorankaj-glitch/P1-Calculator
- Your files should now be visible on GitHub

## Using SSH (Alternative - requires SSH setup)
```bash
git remote add origin git@github.com:authorankaj-glitch/P1-Calculator.git
git push -u origin main
```

## Future Commits
After the initial push, use:
```bash
git add .
git commit -m "Your commit message"
git push
```

