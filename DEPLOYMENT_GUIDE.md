# Silicon Valley Bank and Trust - Deployment Guide

## Domain: siliconvalleybankandtrust.com

---

## Prerequisites

You have:
✅ Domain registered at GoDaddy: siliconvalleybankandtrust.com  
✅ Built application ready in `dist/`  
✅ Production-ready Node.js server  

You need:
- [ ] A hosting provider that supports Node.js 24+
- [ ] SSL certificate (free via Let's Encrypt)
- [ ] Production database setup
- [ ] Environment variables configured

---

## STEP 1: Choose Your Hosting

### Option A: Cloud PaaS (Easiest - Recommended)

**Render.com** (Free tier, auto-SSL, easy setup)

1. **Sign up**: https://render.com
2. **Connect GitHub**: Push your code to GitHub first
3. **New Web Service**:
   ```
   Name: svbt
   Environment: Node
   Build Command: npm ci && npm run build
   Start Command: NODE_ENV=production npm start
   ```
4. **Environment Variables** (Add these):
   ```
   NODE_ENV=production
   APP_ORIGIN=https://siliconvalleybankandtrust.com
   PORT=3000
   HOST=0.0.0.0
   DB_PATH=/opt/render/project/data/bank.sqlite
   STATEMENT_DIR=/opt/render/project/monthly/statements
   TRUST_PROXY=true
   DEMO_SEED=false
   MODERATOR_EMAIL=tpower@siliconvalleybankandtrust.com
   MODERATOR_PASSWORD=<generate-secure-password>
   ```
5. **Deploy** and wait for build
6. **Get your Render URL**: e.g., `svbt-abc123.onrender.com`

---

### Option B: DigitalOcean App Platform

1. **Sign up**: https://www.digitalocean.com
2. **Create App** from GitHub
3. **Configure**:
   - Type: Web Service
   - Environment: Node.js 24
   - Build: `npm ci && npm run build`
   - Run: `npm start`
4. **Add environment variables** (same as above)
5. **Deploy**

---

### Option C: VPS (Full Control - Advanced)

**Best for: Production-grade deployments**

#### Providers:
- DigitalOcean Droplet ($6/month)
- Linode ($5/month)
- Vultr ($6/month)
- AWS Lightsail ($5/month)

#### Setup Steps:

```bash
# 1. SSH into your VPS
ssh root@YOUR_VPS_IP

# 2. Install Node.js 24
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs

# 3. Install Nginx
sudo apt-get install -y nginx certbot python3-certbot-nginx

# 4. Create application directory
sudo mkdir -p /var/www/svbt
sudo chown $USER:$USER /var/www/svbt

# 5. Upload your code (from your local machine)
scp svbt-deployment.tar.gz root@YOUR_VPS_IP:/var/www/svbt/
ssh root@YOUR_VPS_IP "cd /var/www/svbt && tar -xzf svbt-deployment.tar.gz"

# 6. Install dependencies
cd /var/www/svbt
npm ci --production

# 7. Set up environment
cp .env.example .env
nano .env  # Edit with production settings

# 8. Create production moderator (DO NOT USE DEMO PASSWORD)
export MODERATOR_EMAIL="tpower@siliconvalleybankandtrust.com"
read -sp "Enter secure moderator password: " MODERATOR_PASSWORD
export MODERATOR_PASSWORD
npm run create-moderator
unset MODERATOR_PASSWORD

# 9. Install PM2 (process manager)
sudo npm install -g pm2

# 10. Start the application
NODE_ENV=production pm2 start server/index.js --name svbt

# 11. Set PM2 to auto-start on reboot
pm2 startup
pm2 save

# 12. Configure Nginx
sudo nano /etc/nginx/sites-available/svbt
```

**Nginx Configuration** (`/etc/nginx/sites-available/svbt`):
```nginx
server {
    listen 80;
    server_name siliconvalleybankandtrust.com www.siliconvalleybankandtrust.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
# 13. Enable site
sudo ln -s /etc/nginx/sites-available/svbt /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx

# 14. Get SSL certificate (AFTER DNS is configured)
sudo certbot --nginx -d siliconvalleybankandtrust.com -d www.siliconvalleybankandtrust.com
```

---

## STEP 2: Configure DNS in GoDaddy

### After you have your hosting IP or URL:

1. **Go to GoDaddy Domain Settings**:
   - Login to GoDaddy
   - Go to: My Products → Domains
   - Click on `siliconvalleybankandtrust.com`
   - Click "DNS" or "Manage DNS"

### For VPS Hosting (You have an IP address):

2. **Add A Records**:
   ```
   Type: A
   Name: @
   Value: YOUR_VPS_IP_ADDRESS
   TTL: 600 (10 minutes)
   
   Type: A
   Name: www
   Value: YOUR_VPS_IP_ADDRESS
   TTL: 600
   ```

### For PaaS Hosting (Render/Railway/etc):

2. **Add CNAME Record**:
   ```
   Type: CNAME
   Name: @
   Value: svbt-abc123.onrender.com (your render URL)
   TTL: 600
   ```
   
   Or use their provided DNS instructions (Render gives you specific records to add)

3. **Wait for DNS propagation** (5-60 minutes)

---

## STEP 3: Production Environment Configuration

Create your production `.env` file:

```bash
NODE_ENV=production
APP_ORIGIN=https://siliconvalleybankandtrust.com
PORT=3000
HOST=0.0.0.0
DB_PATH=/path/to/production/bank.sqlite
STATEMENT_DIR=/path/to/production/statements
TRUST_PROXY=true

# NEVER use demo credentials in production
DEMO_SEED=false
MODERATOR_EMAIL=tpower@siliconvalleybankandtrust.com
MODERATOR_PASSWORD=<SECURE-PASSWORD-CREATED-WITH-create-moderator-script>
```

**CRITICAL SECURITY:**
- ❌ Never use demo passwords
- ❌ Never deploy with DEMO_SEED=true
- ✅ Generate unique secure password with `create-moderator` script
- ✅ Use HTTPS only
- ✅ Keep .env file secure (not in git)

---

## STEP 4: SSL Certificate (HTTPS)

### Automatic (PaaS):
- Render, Railway, Vercel: **Auto-SSL included** ✅

### Manual (VPS):
```bash
sudo certbot --nginx -d siliconvalleybankandtrust.com -d www.siliconvalleybankandtrust.com
```

Auto-renewal:
```bash
sudo certbot renew --dry-run
```

---

## STEP 5: Database & Backups

### Database Location
Ensure SQLite database is on **local filesystem** (not NFS):
```bash
# Check filesystem type
df -T /var/www/svbt/data
# Should show ext4, xfs, etc. (NOT nfs, cifs)
```

### Backup Strategy
```bash
# Daily backup script
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
sqlite3 /var/www/svbt/data/bank.sqlite ".backup /backups/bank_$DATE.sqlite"
tar -czf /backups/statements_$DATE.tar.gz /var/www/svbt/monthly/statements/
# Upload to S3 or other backup storage
```

---

## STEP 6: Testing

### Before going live:

1. **Test the URL**: https://siliconvalleybankandtrust.com
2. **Verify SSL**: Check for green lock icon
3. **Test login**: Use moderator credentials (NOT demo ones)
4. **Check mobile**: Test on phone browser
5. **Verify 3D scene**: WebGL should load properly
6. **Test transactions**: Create test transaction, generate statement
7. **Download PDF**: Verify statement PDF downloads correctly
8. **Check logs**: Monitor for errors

### Monitoring:
```bash
# VPS: Check PM2 logs
pm2 logs svbt

# Check Nginx access
sudo tail -f /var/log/nginx/access.log

# Check Nginx errors
sudo tail -f /var/log/nginx/error.log
```

---

## Quick Deploy Checklist

- [ ] Choose hosting provider (Render/DigitalOcean/etc)
- [ ] Push code to GitHub (for PaaS) or upload via SCP (for VPS)
- [ ] Set environment variables (production settings)
- [ ] Create secure moderator account (NOT demo password)
- [ ] Deploy application
- [ ] Configure DNS in GoDaddy (A record or CNAME)
- [ ] Wait for DNS propagation
- [ ] Install SSL certificate
- [ ] Test all functionality
- [ ] Set up backups
- [ ] Monitor logs

---

## What Option Should You Choose?

### Choose **Render.com** if:
- ✅ You want the fastest deployment (15 minutes)
- ✅ You want automatic SSL
- ✅ You don't want to manage servers
- ✅ You're okay with free tier limitations (sleeps after inactivity)

### Choose **DigitalOcean Droplet** if:
- ✅ You need 24/7 availability
- ✅ You want full control
- ✅ You're comfortable with Linux server management
- ✅ You need better performance ($6/month for 1GB RAM)

---

## Next Steps

1. **Choose your hosting** (I recommend Render for first deployment)
2. **Follow the setup steps** for your chosen provider
3. **Configure GoDaddy DNS** once you have the IP/URL
4. **Test thoroughly** before announcing
5. **Set up monitoring and backups**

Need help with any specific step? Let me know!

---

## Support Resources

- Render Docs: https://render.com/docs
- DigitalOcean Tutorials: https://www.digitalocean.com/community/tutorials
- Let's Encrypt: https://letsencrypt.org/getting-started/
- GoDaddy DNS Help: https://www.godaddy.com/help/manage-dns-records-680
