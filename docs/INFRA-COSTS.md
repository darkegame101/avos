# AVOS Infrastructure Options & Cost Analysis

**Date Checked:** 2026-10-25  
**Budget Context:** Owner has reported $120 in AWS credits (treat as unverified until refreshed). Monthly budget target is ~$50.

---

## 1. Option Comparison Matrix

| Dimension | Option 1: Lean Staging / VPS (Recommended for Gate 2 & 3) | Option 2: AWS Cloud-Native (ECS Fargate + RDS) |
|---|---|---|
| **Architecture** | Single-instance container runtime on AWS Lightsail or VPS with Docker Compose | Managed Container Service (ECS Fargate) + Managed Database (AWS RDS PostgreSQL) |
| **Compute** | AWS Lightsail (2 vCPU, 4 GB RAM, 80 GB SSD, 3 TB transfer) | AWS ECS Fargate: 0.5 vCPU, 1 GB RAM (Core API) + 1.0 vCPU, 2 GB RAM (Worker) |
| **Database** | Containerized PostgreSQL 16 on local SSD with automated daily S3 dumps | AWS RDS PostgreSQL `db.t4g.micro` (Single-AZ, 20 GB gp3 storage) |
| **Task Queue** | Internal PostgreSQL-backed durable queue (SKIP LOCKED) | Internal PostgreSQL-backed durable queue or AWS SQS Standard |
| **Storage & Backups** | 80 GB NVMe included; daily encrypted backups to AWS S3 (~$0.50/mo) | 20 GB gp3 RDS storage + 10 GB automated snapshot retention |
| **Monitoring** | Prometheus + Grafana container / Netdata + health ping check | AWS CloudWatch Logs & Metrics + Container Insights |
| **Public IPv4** | 1 Static IPv4 included in bundle | NAT Gateway ($32.40/mo) OR Public Subnets with direct IPv4 ($3.60/mo each) |
| **Estimated Monthly Cost** | **$20.00 – $24.00 / month** | **$82.00 – $115.00 / month** |
| **AWS Credit Eligibility** | Eligible for compute/storage charges on AWS Lightsail | Eligible for Fargate & RDS compute/storage; NAT Gateway & DNS charges may vary |
| **Operational Burden** | Low: Simple docker-compose lifecycle, easy rollback, zero cloud lock-in | Medium: Requires IAM roles, VPC subnets, security groups, task definitions |

---

## 2. Detailed Breakdown

### Option 1: Lean Staging (AWS Lightsail or Lean Cloud VPS) — *RECOMMENDED*
- **Compute & OS:** AWS Lightsail $20/month plan (2 vCPUs, 4 GB RAM, 80 GB SSD, 3 TB bandwidth, 1 static IPv4).
- **Database:** Local Docker container running PostgreSQL 16 with durable volume mount.
- **Backups:** Nightly pg_dump script uploaded to AWS S3 Glacier Instant Retrieval (~$0.50/mo).
- **Why this fits best:**
  1. Easily fits inside the $50/month ceiling and will consume only ~$20 of the $120 credit per month (giving 6 months of runway!).
  2. 4 GB RAM comfortably supports Node.js Core, PostgreSQL, worker processes, and 1-2 concurrent headless Chromium browser sessions for research.
  3. No surprise egress or per-hour NAT Gateway fees.

### Option 2: AWS Cloud-Native (Fargate + RDS + SQS)
- **ECS Fargate Compute:**
  - 1x API service (0.5 vCPU, 1 GB RAM) = ~$15.50/mo
  - 1x Worker service (1.0 vCPU, 2 GB RAM) = ~$31.00/mo
- **Database (RDS):**
  - `db.t4g.micro` Single-AZ with 20 GB gp3 = ~$18.00/mo
- **Networking & Public IPv4:**
  - 2 Public IPv4 addresses for tasks = $7.20/mo
  - S3 backups + CloudWatch Logs = ~$5.00/mo
- **Total:** ~$82.00 – $95.00/mo (Exceeds $50/mo target without credits; credit covers ~1.2 months only).

---

## 3. Analysis of the $120 AWS Credit

> [!WARNING]
> Treat the $120 AWS credit as provisional until confirmed in the AWS Billing Console.

1. **What is covered:** Standard EC2, Lightsail compute, EBS/Lightsail disks, RDS compute, and S3 storage.
2. **What is frequently NOT covered or carries gotchas:** Route53 domain registrations, marketplace subscriptions, certain third-party software licenses, and taxes.
3. **Recommendation:**
   - Deploy Phase 1 & 2 to Option 1 (Lightsail @ $20/mo).
   - This maximizes the $120 credit to last **up to 6 months** while keeping development risk minimal.
   - Do NOT spin up production cloud resources without explicit owner authorization.
