# AVOS — AWS Lightsail Staging Deployment Plan

**Status:** Plan Prepared — **Awaiting Explicit Human Owner Approval**  
**Estimated Monthly Spend:** **$20.00 – $20.50 / month**  
**Expected Runway with $120 AWS Credit:** **5.8 months**

---

## 1. Specification & Sizing

| Component | Specification | Cost per Month | Notes |
|---|---|---|---|
| **Lightsail Instance** | 2 vCPUs, 4 GB RAM, 80 GB SSD, 3 TB Bandwidth | **$20.00** | Covered by AWS Credits |
| **Static IPv4** | 1 Dedicated IPv4 | **$0.00** | Free while attached to running instance |
| **S3 Backup Storage** | Daily encrypted dumps (10 GB storage) | **~$0.50** | S3 Glacier Instant Retrieval |
| **Domain / SSL** | Let's Encrypt automated TLS certificate | **$0.00** | Free & auto-renewed |
| **Total Projected** | | **$20.50 / month** | |

### Excluded / Variable Charges (Non-AWS or Out-of-Bundle)
1. **Third-Party LLM Token Costs:** Any commercial AI model tokens (Anthropic, OpenAI) are billed directly by those providers and do **not** consume AWS credits.
2. **Idle IP Charge:** If the Lightsail instance is deleted but the static IP is retained unattached, AWS bills $0.005/hour ($3.60/month). The teardown runbook releases the IP immediately upon instance removal.
3. **Bandwidth Over 3 TB:** Overage is billed at $0.09/GB (AVOS estimated traffic is <50 GB/month).

---

## 2. Least-Privilege IAM Policy (`AVOSLightsailDeployer`)

If an automated IAM deployer user or CI role is used to provision Lightsail, apply this strict least-privilege policy. It restricts actions strictly to Lightsail in the chosen region and denies account/billing/IAM modifications:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowLightsailOperations",
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
      "Sid": "AllowS3BackupBucket",
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
        "organizations:*"
      ],
      "Resource": "*"
    }
  ]
}
```

---

## 3. Deployment Steps (Upon Owner Sign-Off)

1. **Launch Instance:**
   ```bash
   aws lightsail create-instances \
     --instance-names "avos-staging" \
     --availability-zone "ap-southeast-1a" \
     --blueprint-id "ubuntu_22_04" \
     --bundle-id "medium_2_0"
   ```
2. **Attach Static IP:**
   ```bash
   aws lightsail allocate-static-ip --static-ip-name "avos-staging-ip"
   aws lightsail attach-static-ip --static-ip-name "avos-staging-ip" --instance-name "avos-staging"
   ```
3. **Configure Firewall:**
   ```bash
   aws lightsail put-instance-public-ports \
     --instance-name "avos-staging" \
     --port-infos '[
       {"fromPort": 80, "toPort": 80, "protocol": "tcp"},
       {"fromPort": 443, "toPort": 443, "protocol": "tcp"},
       {"fromPort": 22, "toPort": 22, "protocol": "tcp", "cidrs": ["<OWNER_IP>/32"]}
     ]'
   ```
4. **Deploy Application:**
   Clone repository, inject `.env` with production secrets, start `docker compose up -d`.

---

## 4. Rollback & Teardown Protocol

To completely tear down the environment with zero lingering charges:
```bash
# 1. Export final database backup
docker compose exec postgres pg_dump -U avos_user avos_db > final_backup.sql

# 2. Release static IP
aws lightsail detach-static-ip --static-ip-name "avos-staging-ip"
aws lightsail release-static-ip --static-ip-name "avos-staging-ip"

# 3. Terminate instance
aws lightsail delete-instance --instance-name "avos-staging"
```

---

## 5. Non-Action Guarantee
> [!IMPORTANT]
> **No cloud instances, storage volumes, or paid resources have been created.**  
> Execution will remain paused at Gate 4 until the human owner explicitly signs off on this deployment plan.
