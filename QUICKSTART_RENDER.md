# 🚀 Quick Deploy to Render.com (15 Minutes)

This is the **fastest way** to get SVBT live on siliconvalleybankandtrust.com.

---

## Step 1: Push Code to GitHub (5 min)

```bash
# Initialize git (if not already done)
cd /workspace
git init
git add .
git commit -m "Initial SVBT build"

# Create GitHub repo and push
# Go to github.com → New Repository → "svbt"
git remote add origin https://github.com/YOUR_USERNAME/svbt.git
git branch -M main
git push -u origin main
```

---

## Step 2: Deploy to Render (5 min)

1. **Sign up**: Go to https://render.com (free account)

2. **New Web Service**:
   - Click "New +" → "Web Service"
   - Connect your GitHub account
   - Select the `svbt` repository
   
3. **Configure**:
   ```
   Name: svbt
   Region: Oregon (US West) or closest to you
   Branch: main
   Runtime: Node
   Build Command: npm ci && npm run build
   Start Command: npm start
   Instance Type: Free
   ```

4. **Environment Variables** (click "Advanced"):
   ```
   NODE_ENV=production
   APP_ORIGIN=https://siliconvalleybankandtrust.com
   DB_PATH=/opt/render/project/src/data/bank.sqlite
   STATEMENT_DIR=/opt/render/project/src/monthly/statements
   TRUST_PROXY=true
   DEMO_SEED=false
   MODERATOR_EMAIL=tpower@siliconvalleybankandtrust.com
   MODERATOR_PASSWORD=YourSecurePassword123!@#
   ```
   
   ⚠️ **Change MODERATOR_PASSWORD** to something secure!

5. **Create Web Service** and wait ~5 minutes for build

6. **Your URL**: You'll get something like `svbt-xyz123.onrender.com`

---

## Step 3: Connect Domain in GoDaddy (5 min)

### Option A: Custom Domain in Render (Easier)

1. **In Render Dashboard**:
   - Go to your `svbt` service
   - Click "Settings" tab
   - Scroll to "Custom Domain"
   - Click "Add Custom Domain"
   - Enter: `siliconvalleybankandtrust.com`
   
2. **Render will show you DNS records** like:
   ```
   Type: CNAME
   Name: siliconvalleybankandtrust.com
   Value: svbt-xyz123.onrender.com
   ```

3. **Add in GoDaddy**:
   - Go to GoDaddy → My Products → siliconvalleybankandtrust.com
   - Click "DNS" or "Manage DNS"
   - Click "Add" record
   - Copy the CNAME details from Render
   - Save

4. **Wait 10-60 minutes** for DNS propagation

5. **Render auto-enables HTTPS** with free SSL certificate ✅

---

### Option B: Manual DNS (Alternative)

1. **In GoDaddy DNS**:
   ```
   Type: CNAME
   Name: @
   Value: svbt-xyz123.onrender.com
   TTL: 600
   ```

2. **Update APP_ORIGIN in Render**:
   - Environment Variables → APP_ORIGIN
   - Change to: `https://siliconvalleybankandtrust.com`
   - Save → Redeploy

---

## Step 4: Initialize Production Database

**After first deployment**:

1. **Render Dashboard** → Your service → "Shell" tab
2. **Run seed command** (one-time):
   ```bash
   npm run seed
   ```
   
   This creates the demo moderator account.

⚠️ **Or** create a secure moderator without demo data:
   ```bash
   export DEMO_SEED=false
   export MODERATOR_EMAIL="tpower@siliconvalleybankandtrust.com"
   export MODERATOR_PASSWORD="YourSecurePassword!2026"
   npm run create-moderator
   ```

---

## Step 5: Test!

1. Visit: **https://siliconvalleybankandtrust.com**
2. Click "Moderator access" in footer
3. Login with your credentials
4. Create a test customer
5. Post some transactions
6. Generate a statement

---

## What You Get (Free Tier)

✅ **Automatic HTTPS** with SSL certificate  
✅ **Auto-deploy** on git push  
✅ **Automatic restarts** if app crashes  
✅ **Environment variables** management  
✅ **Logs** and monitoring  

⚠️ **Limitations**:
- App sleeps after 15 min of inactivity (wakes on request in ~30 sec)
- 750 hours/month free (enough for testing)
- For 24/7 uptime, upgrade to $7/month Starter plan

---

## Upgrade to Paid ($7/month) When Ready

When Tim is ready for production:

1. Render Dashboard → Upgrade to "Starter" ($7/month)
2. Gets you:
   - ✅ No sleeping
   - ✅ More RAM/CPU
   - ✅ Daily backups
   - ✅ Better support

---

## Troubleshooting

### "App won't start"
- Check logs in Render dashboard
- Verify Node.js version in package.json
- Check environment variables

### "Database locked"
- Use local filesystem for DB_PATH (Render's disk is okay)
- Don't use shared/network storage

### "Domain not working"
- Wait 30-60 min for DNS propagation
- Check DNS settings in GoDaddy
- Verify CNAME points to correct Render URL

### "SSL not working"
- Render auto-provisions SSL after domain is verified
- Make sure APP_ORIGIN uses `https://`

---

## 🎉 You're Live!

Once DNS propagates, **siliconvalleybankandtrust.com** will show your banking application with:
- ✅ HTTPS/SSL encryption
- ✅ 3D WebGL graphics
- ✅ Customer/Moderator portals
- ✅ PDF statement generation
- ✅ Secure authentication

**Total time: ~15 minutes + DNS wait time**

Ready to deploy? Start with Step 1! 🚀
