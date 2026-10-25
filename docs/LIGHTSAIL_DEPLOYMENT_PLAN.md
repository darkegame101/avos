# AVOS — AWS Lightsail Staging Deployment Plan

**Status:** Plan Prepared & Audited — **Awaiting Explicit Human Owner Approval**  
**Projected AWS Monthly Spend:** **$20.00 – $20.50 / month**  
**Projected Runway with $120 AWS Credit:** **~5.8 months** (subject to Credit eligibility verification)

---

## 1. Cost Verification & Breakdown: Verified vs. Estimated

### 1.1 Verified AWS Pricing (Standard Regions: `ap-southeast-1`, `us-east-1`, `us-west-2`, `eu-west-1`)
| Component | Official AWS Price | Billing Classification | Verification Basis |
|---|---|---|---|
| **Lightsail Instance (`medium_2_0`)**<br>(2 vCPUs, 4 GB RAM, 80 GB SSD, 3 TB Bandwidth) | **$20.00 / month** | **VERIFIED AWS PRICING** | AWS Lightsail official bundle matrix. |
| **Attached Static IPv4** | **$0.00 / month** | **VERIFIED AWS PRICING** | 1 Static IPv4 is included free while attached to a running instance. |
| **Outbound Data Transfer** (up to 3 TB) | **$0.00 / month** | **VERIFIED AWS PRICING** | Included in bundle quota. AVOS consumes <50 GB/mo. |
| **TLS/SSL Certificate** | **$0.00 / month** | **VERIFIED PRICING** | Let's Encrypt automated certificate (auto-renewing). |

### 1.2 Estimated Costs (Variable by actual usage)
| Component | Estimated Monthly Cost | Estimation Assumptions |
|---|---|---|
| **Off-site S3 Glacier Backup** | **~$0.50 / month** | Daily compressed PostgreSQL dump (~30 MB/day, 10 GB retention) @ $0.004/GB + PUT requests. |
| **Lightsail Native Snapshots** (Optional) | **~$0.10 – $0.25 / month** | AWS charges $0.05/GB-month for differential snapshot storage. |
| **Total Projected AWS Spend** | **$20.50 / month** | **Runway: ~5.8 months** on $120 credit. |

### 1.3 Critical Verification Required: $120 AWS Credit Conditions
> [!WARNING]
> **Owner Verification Required Before Provisioning:**
> AWS Promotional Credits vary widely in scope:
> 1. **Applicable Services:** Some promotional credits apply to all AWS services (including Amazon Lightsail), while others restrict coverage to EC2, S3, or RDS, **excluding Lightsail**.
> 2. **Expiration Date:** Credits expire on a set date; unspent balances do not roll over.
> 
> **Action for Owner:** Check `AWS Console -> Billing and Cost Management -> Credits`:
> - Verify that `Amazon Lightsail` is listed under `Applicable Products` (or `All AWS Services`).
> - Confirm the expiration date is at least 3-6 months out.
> - If Lightsail is excluded by your credit code, running Lightsail will bill directly to your registered credit card at $20/month.

### 1.4 Excluded & Variable Non-AWS Charges
1. **Third-Party Commercial AI Models:** Any API calls to OpenAI (GPT-4o), Anthropic (Claude 3.5), or Google (Gemini API) are billed directly by those independent providers and **never** consume AWS credits.
2. **Idle IP Charge:** If the Lightsail instance is stopped or deleted but the static IP remains allocated, AWS bills $0.005/hour ($3.60/month). The teardown protocol below releases the IP immediately.
3. **Data Egress Over 3 TB:** Billed at $0.09/GB (AVOS usage is far below 3 TB).

---

## 2. Infrastructure Architecture & Hardening

```mermaid
graph TD
    Client["Client / Owner Browser"] -->|HTTPS 443 / Bearer Token| Nginx["Nginx / Caddy Reverse Proxy<br>(Let's Encrypt TLS)"]
    Client -.->|SSH Port 22<br>(Whitelisted Owner IP only)| SSH["OpenSSH Server"]
    
    subgraph "Docker Compose Isolation Network"
        Nginx -->|Proxy pass 4000| AvosCore["AVOS Core Container<br>(Node 22-alpine, PID non-root)"]
        AvosCore -->|Internal SQL 5432| Postgres["Postgres 16-alpine<br>(avos_app_user, least privilege)"]
        Postgres --> PV["postgres_data Volume<br>(Host Mount)"]
    end

    AvosCore -->|Backup Dump| S3["AWS S3 Bucket<br>(Encrypted, Glacier Lifecycle)"]
```

### Security Controls:
1. **Firewall / Public Ports:**
   - **Port 80 (TCP):** Open for Let's Encrypt ACME HTTP challenge; redirects all other traffic to 443.
   - **Port 443 (TCP):** Open to public for API Control Plane and Admin Dashboard. Protected by Bearer token authentication and rate limiting (120 req/min).
   - **Port 22 (TCP):** Restricted strictly to owner's CIDR IP (`<OWNER_IP>/32`). Password login disabled; Ed25519 SSH keys only.
   - **Port 5432 (PostgreSQL):** NEVER exposed to the public internet; bound strictly to Docker internal bridge network.
2. **Least-Privilege Database Access:**
   - AVOS Core connects via `avos_app_user` (created via `migrations/002_least_privilege_user.sql`).
   - Role has DML privileges on `avos_db` only. Cannot DROP DATABASE, cannot alter schemas, has no superuser privileges.
3. **Emergency Stop Persistence:**
   - Stored in PostgreSQL `emergency_stop_state` table.
   - Preserved across container and VPS reboots.

---

## 3. Least-Privilege IAM Policy (`AVOSLightsailDeployer`)

If automated IAM credentials or GitHub Actions CI are used to deploy, attach this policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowLightsailOperationsInRegion",
      "Effect": "Allow",
      "Action": [
        "lightsail:GetInstance",
        "lightsail:GetInstances",
        "lightsail:CreateInstances",
        "lightsail:StartInstance",
        "lightsail:StopInstance",
        "lightsail:RebootInstance",
        "lightsail:DeleteInstance",
        "lightsail:OpenInstancePublicPorts",
        "lightsail:PutInstancePublicPorts",
        "lightsail:AllocateStaticIp",
        "lightsail:AttachStaticIp",
        "lightsail:ReleaseStaticIp"
      ],
      "Resource": "*"
    },
    {
      "Sid": "AllowBackupBucketStorage",
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::avos-backups-*",
        "arn:aws:s3:::avos-backups-*/*"
      ]
    },
    {
      "Sid": "ExplicitDenyHighRiskServices",
      "Effect": "Deny",
      "Action": [
        "iam:*",
        "aws-portal:*",
        "ce:*",
        "cur:*",
        "organizations:*",
        "ec2:RunInstances"
      ],
      "Resource": "*"
    }
  ]
}
```

---

## 4. Monitoring, Health Checks & Stop Conditions

### 4.1 Automated CloudWatch & Lightsail Alarms:
1. **CPUUtilization > 85% for 15 minutes:** Triggers alarm email to owner.
2. **StatusCheckFailed > 0:** Triggers notification.
3. **AWS Billing Alert:** Trigger alert at **$25.00** monthly projected spend to guarantee zero unexpected overages beyond the $20 baseline.

### 4.2 Emergency Stop Conditions:
The system automatically halts or requires owner intervention under any of the following conditions:
- **Budget Breach:** Global portfolio spend exceeds $50.00/month.
- **Unattached Static IP Detected:** Automated cleanup script alerts and releases IP to prevent idle charge.
- **Security Anomaly:** 5 consecutive failed authentication attempts from any IP triggers temporary block.
- **Owner Stop:** Any trigger of `POST /api/emergency/stop` immediately suspends all active and queued tasks.

---

## 5. Deployment Commands (Run ONLY upon Owner Sign-Off)

```bash
# 1. Launch instance in chosen region (default: ap-southeast-1)
aws lightsail create-instances \
  --instance-names "avos-staging" \
  --availability-zone "ap-southeast-1a" \
  --blueprint-id "ubuntu_22_04" \
  --bundle-id "medium_2_0"

# 2. Allocate and attach static IP
aws lightsail allocate-static-ip --static-ip-name "avos-staging-ip"
aws lightsail attach-static-ip --static-ip-name "avos-staging-ip" --instance-name "avos-staging"

# 3. Lock down firewall
aws lightsail put-instance-public-ports \
  --instance-name "avos-staging" \
  --port-infos '[
    {"fromPort": 80, "toPort": 80, "protocol": "tcp"},
    {"fromPort": 443, "toPort": 443, "protocol": "tcp"},
    {"fromPort": 22, "toPort": 22, "protocol": "tcp", "cidrs": ["<OWNER_IP>/32"]}
  ]'
```

---

## 6. One-Command Rollback & Teardown Protocol

If staging must be terminated, destroyed, or rolled back:

```bash
# 1. Export final PostgreSQL database dump
docker compose exec postgres pg_dump -U avos_app_user avos_db > final_backup_$(date +%Y%m%d_%H%M%S).sql

# 2. Detach and release static IP (CRITICAL: prevents idle charge)
aws lightsail detach-static-ip --static-ip-name "avos-staging-ip"
aws lightsail release-static-ip --static-ip-name "avos-staging-ip"

# 3. Delete Lightsail instance
aws lightsail delete-instance --instance-name "avos-staging"
```

---

## 7. Strict Non-Action Guarantee

> [!IMPORTANT]
> **NO CLOUD INSTANCES, STORAGE BUCKETS, OR BILLABLE RESOURCES HAVE BEEN CREATED.**  
> AVOS remains strictly confined to local development and testing. Cloud execution will only take place after explicit, written approval from the owner.
