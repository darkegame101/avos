# AVOS Pre-Deployment Gate Report

**Date:** 2026-10-25  
**Assessment:** Gate 1, Gate 2, Gate 3, Gate 4 **VERIFIED** | Gate 5 **BLOCKED (Awaiting Owner Sign-Off)**  
**Security Lead / Coding Agent:** AVOS Agent  
**Target Repository:** [https://github.com/darkegame101/avos.git](https://github.com/darkegame101/avos.git) (`main` branch)

---

## 1. Repository & CI/CD Status (Direct GitHub Verification)

- **Repository Remote:** `https://github.com/darkegame101/avos.git`
- **Active Branch:** `main` (tracked directly with `origin/main`)
- **Current `main` HEAD Commit:** `024bdb18da8ac7db040c0f7c9f9ab3c3faaa7dcd` (`024bdb1`)
  - **Commit Message:** `docs: sync STATUS.md and PREDEPLOYMENT_GATE_REPORT.md with verified CI Run 40163040146`
  - **GitHub Actions CI Run:** [Run #40163132384](https://github.com/darkegame101/avos/actions/runs/40163132384)
  - **CI Status:** `completed` / `success` **(GREEN)**
- **Prior Code & Security Hardening Commit:** `e22b70085393a8f60d7b50f707d1ca169f306831` (`e22b700`)
  - **Commit Message:** `security(gate): verify execution boundary, purge credentials, harden SSRF, and add pre-deployment audit report`
  - **GitHub Actions CI Run:** [Run #40163040146](https://github.com/darkegame101/avos/actions/runs/40163040146)
  - **CI Status:** `completed` / `success` **(GREEN)**

### Sự khác biệt kỹ thuật giữa `024bdb1` và `e22b700`:
- **Commit `e22b700` (Core Code & Hardening):** Là commit mã nguồn triển khai toàn bộ các chốt chặn an ninh:
  1. Loại bỏ thông tin xác thực thử nghiệm trong file test; tạo role [migrations/002_least_privilege_user.sql](file:///e:/AVOS-AI-Agent-Handoff/migrations/002_least_privilege_user.sql) cho `avos_app_user`.
  2. Bổ sung phòng thủ SSRF, chống DNS Rebinding qua `validateTargetUrlAsync`, bắt buộc manual redirect và chặn các giao thức mạng nguy hiểm (`ws:`, `wss:`, `ftp:`) trong [src/adapters/browserSandbox.ts](file:///e:/AVOS-AI-Agent-Handoff/src/adapters/browserSandbox.ts).
  3. Bổ sung HTTP Security Headers, cơ chế rate limiting (120 req/min) và chặn mạo danh body trong [src/api/server.ts](file:///e:/AVOS-AI-Agent-Handoff/src/api/server.ts).
  4. Bổ sung cơ chế cô lập dự án chéo trong [src/gateway/executionGateway.ts](file:///e:/AVOS-AI-Agent-Handoff/src/gateway/executionGateway.ts).
  5. Thêm negative attack tests trong các file kiểm thử, nâng tổng số test lên 49 tests.
- **Commit `024bdb1` (Documentation Synchronization):** Là commit đồng bộ tài liệu, **không thay đổi một dòng code nào** (`0 files code changed`). Commit này chỉ cập nhật 2 dòng trong `docs/STATUS.md` và `docs/PREDEPLOYMENT_GATE_REPORT.md` để ghi nhận commit SHA `e22b700` và CI Run ID `40163040146`.
- **Cả hai commit đều đã được GitHub Actions kiểm thử độc lập và đạt kết quả 100% SUCCESS (GREEN).**

---

## 2. Phân Định Ba Tầng Nhận Thức (Epistemic Classification)

Theo nguyên tắc minh bạch, báo cáo phân loại rõ ràng mọi khẳng định an ninh và vận hành thành 3 nhóm:

### Tầng 1: Đã kiểm chứng thực tế (Empirically Verified)
*Các khẳng định có dữ liệu hoặc kết quả chạy máy đo lường được trực tiếp:*
1. **Kiểm thử tự động:** 49/49 automated tests chạy thành công trên 7 test suites trong Vitest cục bộ và trên GitHub Actions CI runner (`ubuntu-latest` với container `postgres:16-alpine`).
2. **Biên dịch & Kiểu dữ liệu:** `npm run build` (`tsc`) biên dịch sạch sẽ với exit code 0.
3. **Vệ sinh bí mật:** Lệnh `git grep -n "123456"` trả về 0 kết quả trên toàn bộ mã nguồn và lịch sử tracked files hiện tại.
4. **Cơ chế khóa đồng thời:** Test atomic leasing với `SELECT FOR UPDATE SKIP LOCKED` trong PostgreSQL đã chứng minh worker thứ hai nhận `null` khi tác vụ đang bị khóa bởi worker thứ nhất.
5. **Giá niêm yết dịch vụ:** Giá gói máy chủ Lightsail `medium_2_0` (2 vCPU, 4GB RAM) được niêm yết chính thức là $20.00/tháng trên bảng giá công khai của AWS.

### Tầng 2: Suy luận từ cấu trúc mã nguồn (Inferred / Structural Logic)
*Các khẳng định dựa trên logic kiến trúc code nhưng chưa trải qua tải thực tế lâu dài:*
1. **Khả năng chống bypass ranh giới:** Suy luận từ việc kiến trúc mã nguồn không truyền `IRuntimeAdapter` vào `buildServer(services)`, và Worker chỉ thực thi qua `ExecutionGateway.executeTask`.  
   *Giới hạn suy luận:* Đây là ranh giới logic ở tầng TypeScript. Nếu trong tương lai có thêm dependency bên thứ ba hoặc cấu hình mở rộng không kiểm soát, vẫn có thể phát sinh rủi ro monkey-patching hoặc side-channel.
2. **Khả năng chịu tải & ổn định:** Suy luận từ các test concurrency ngắn hạn. Hệ thống chưa trải qua kiểm thử ngâm (soak test) nhiều ngày trong điều kiện mạng internet thực tế (nguy cơ rò rỉ bộ nhớ của Chromium headless, cạn kiệt connection pool khi database bị trễ mạng).
3. **Hành vi mạng đám mây:** Cơ chế anti-SSRF hoạt động chuẩn xác trong môi trường kiểm thử; tuy nhiên khi chạy trên AWS Lightsail thực tế, cấu hình phân giải DNS nội bộ của AWS VPC (như `169.254.169.253` DNS resolver) cần tiếp tục được theo dõi.

### Tầng 3: Chưa xác minh / Cần chủ sở hữu xác nhận (Unverified / Blocked)
*Các hạng mục chưa có dữ liệu thực tế và bắt buộc phải có sự tham gia của con người:*
1. **Tính hợp lệ của $120 AWS Credit:** Chưa xác minh được mã credit này có cho phép áp dụng cho `Amazon Lightsail` hay bị loại trừ, và ngày hết hạn cụ thể là khi nào.
2. **Tài nguyên Cloud:** Chưa tạo bất kỳ VPS, Static IP, Firewall rule hay S3 bucket nào trên AWS.
3. **Chứng chỉ TLS thực tế:** Chưa kiểm chứng việc phát hành chứng chỉ Let's Encrypt trên tên miền và địa chỉ IP công khai thực tế.
4. **Mật khẩu cơ sở dữ liệu cục bộ của chủ sở hữu:** Agent không truy cập và không xác minh được liệu chủ sở hữu đã đổi mật khẩu root của PostgreSQL trên máy cá nhân hay chưa.

---

## 3. Quản Lý Thông Tin Xác Thực PostgreSQL

- **Ghi nhận trạng thái:** Trong các phiên thử nghiệm cục bộ trước đây, mã nguồn kiểm thử từng thử kết nối với mật khẩu thử nghiệm mặc định vào cổng PostgreSQL cục bộ.
- **Xử lý phía kho mã nguồn:** Toàn bộ thông tin này đã được gỡ bỏ hoàn toàn khỏi mã nguồn, test script và tài liệu. Dự án hiện sử dụng biến môi trường chuẩn (`DATABASE_URL`, `PGPASSWORD`) với các giá trị placeholder.
- **Yêu cầu đối với chủ sở hữu:** 
  > [!NOTE]
  > Agent tuyệt đối không truy cập, không đoán và không in lại mật khẩu.  
  > Chủ sở hữu cần **tự xác nhận** đã đổi mật khẩu của tài khoản `postgres` (superuser) trên dịch vụ PostgreSQL của máy tính cá nhân nếu mật khẩu thử nghiệm trước đây từng được dùng làm mật khẩu thật. Không tái sử dụng mật khẩu đó cho bất kỳ môi trường nào khác.

---

## 4. Chi Phí & Hướng Dẫn Chủ Sở Hữu Kiểm Tra AWS Credits

### 4.1 Bảng chi tiết chi phí dự kiến
| Hạng mục | Chi phí / tháng | Phân loại | Căn cứ & Ghi chú |
|---|---|---|---|
| **Lightsail Instance (`medium_2_0`)**<br>(2 vCPU, 4GB RAM, 80GB SSD, 3TB Data) | **$20.00** | **ĐÃ KIỂM CHỨNG THEO AWS PRICING** | Giá niêm yết chính thức của AWS tại `ap-southeast-1` (Singapore) và `us-east-1` (N. Virginia). |
| **Static IPv4 đính kèm** | **$0.00** | **ĐÃ KIỂM CHỨNG THEO AWS PRICING** | Miễn phí 1 IP tĩnh khi đang gắn vào máy chủ đang chạy. |
| **Băng thông ra ngoài (Dưới 3 TB)** | **$0.00** | **ĐÃ KIỂM CHỨNG THEO AWS PRICING** | Đã bao gồm trong bundle của Lightsail. |
| **TLS/SSL Certificate** | **$0.00** | **ĐÃ KIỂM CHỨNG MIỄN PHÍ** | Let's Encrypt tự động cấp phát. |
| **Lưu trữ Backup S3 Glacier Instant Retrieval** | **~$0.50** | **ƯỚC TÍNH THEO SỬ DỤNG** | Tính trên ~10 GB SQL dump nén luân chuyển 30 ngày ($0.004/GB/tháng) + phí PUT requests. |
| **Snapshot Lightsail tự động (Tùy chọn)** | **~$0.10 – $0.25** | **ƯỚC TÍNH THEO SỬ DỤNG** | Phí lưu trữ snapshot vi sai là $0.05/GB-tháng. |
| **TỔNG CHI PHÍ AWS DỰ KIẾN** | **~$20.50 / tháng** | | **Thời gian hoạt động dự kiến: ~5.8 tháng** nếu $120 Credit hợp lệ. |

### 4.2 Hướng dẫn chủ sở hữu tự kiểm tra AWS Credits (Không cần cấp quyền Billing/IAM cho agent)
Để bảo đảm an toàn tuyệt đối, chủ sở hữu tự thực hiện các bước sau trên trình duyệt của mình:

1. **Đăng nhập vào AWS Console:** Truy cập [https://console.aws.amazon.com/](https://console.aws.amazon.com/) bằng tài khoản root hoặc IAM user cá nhân.
2. **Kiểm tra thông tin Credit:**
   - Mở menu góc trên bên phải (tên tài khoản) → Chọn **Billing and Cost Management**.
   - Ở thanh điều hướng bên trái, chọn **Credits** (hoặc truy cập trực tiếp: `https://console.aws.amazon.com/billing/home#/credits`).
   - Tìm khoản tín dụng $120 và kiểm tra 3 thông số then chốt:
     - **Applicable Products:** Xác nhận xem danh sách có chứa `Amazon Lightsail` hoặc ghi `All AWS Services` hay không. *Nếu ghi rõ "Excludes Lightsail", chi phí $20/tháng sẽ trừ trực tiếp vào thẻ ngân hàng.*
     - **Expiration Date:** Xác nhận thời hạn hết hạn còn ít nhất 3-6 tháng.
     - **Remaining Balance:** Xác nhận số dư còn đủ $120.
3. **Thiết lập cảnh báo chi phí (AWS Budgets Alert):**
   - Trong **Billing and Cost Management**, chọn **Budgets** → Chọn **Create budget**.
   - Chọn **Cost budget (Simplified)**.
   - Đặt ngưỡng ngân sách: **$25.00 / month**.
   - Điền email cá nhân để nhận cảnh báo ngay lập tức nếu chi phí vượt quá $25, đảm bảo không có chi phí ẩn ngoài tầm kiểm soát.

---

## 5. Rà Soát Điều Kiện Vận Hành & Các Giới Hạn Kỹ Thuật Còn Tồn Tại

### 5.1 Quyền IAM Tối Thiểu (`AVOSLightsailDeployer`)
- **Phạm vi cấp quyền:** Chỉ cho phép các thao tác cần thiết trên dịch vụ Lightsail (`lightsail:*Instance*`, `lightsail:*StaticIp*`, `lightsail:*PublicPorts*`) và quyền ghi/đọc vào đúng bucket backup `arn:aws:s3:::avos-backups-*`.
- **Cấm tuyệt đối (Explicit Deny):** Cấm `iam:*`, `aws-portal:*`, `ce:*` (Cost Explorer), `organizations:*`, và cấm tạo EC2 đắt tiền (`ec2:RunInstances`).
- **Giới hạn kỹ thuật:** Dịch vụ Lightsail của AWS hiện tại chưa hỗ trợ ràng buộc ARN cấp tài nguyên chi tiết cho tất cả hành động tạo mới (ví dụ `lightsail:CreateInstances` bắt buộc khai báo `"Resource": "*"`).

### 5.2 Cơ Chế Rollback & Giới Hạn
- **Điều kiện kích hoạt rollback:**
  1. Nhận email cảnh báo chi phí AWS Budget vượt ngưỡng $25.
  2. Phát hiện máy chủ bị crash loop hoặc không phản hồi kiểm tra sức khỏe quá 15 phút.
  3. Kích hoạt Emergency Stop mà không thể khắc phục nguyên nhân.
  4. Yêu cầu chủ động từ chủ sở hữu.
- **Quy trình thực hiện:**
  ```bash
  # 1. Xuất bản backup cuối cùng từ container PostgreSQL
  docker compose exec postgres pg_dump -U avos_app_user avos_db > final_backup.sql
  
  # 2. Giải phóng Static IP (BẮT BUỘC để tránh phí $3.60/tháng của IP nhàn rỗi)
  aws lightsail detach-static-ip --static-ip-name "avos-staging-ip"
  aws lightsail release-static-ip --static-ip-name "avos-staging-ip"
  
  # 3. Hủy bỏ máy chủ Lightsail
  aws lightsail delete-instance --instance-name "avos-staging"
  ```
- **Giới hạn kỹ thuật:** Lệnh `delete-instance` là vĩnh viễn; mọi dữ liệu trên ổ SSD cục bộ chưa kịp dump ra file sẽ bị xóa. RPO (Recovery Point Objective) tối đa là 24 giờ dựa trên bản sao lưu S3 gần nhất.

### 5.3 Giao Thức Mạng, SSH & TLS
- **Firewall & SSH:** Cổng 22 SSH chỉ mở cho địa chỉ IP tĩnh của chủ sở hữu (`<OWNER_IP>/32`). Đăng nhập bằng mật khẩu bị vô hiệu hóa; bắt buộc dùng khóa SSH Ed25519.
  - *Giới hạn kỹ thuật:* Nếu chủ sở hữu sử dụng mạng internet gia đình có IP động (Dynamic IP), khi nhà mạng đổi IP, chủ sở hữu sẽ tạm thời không thể SSH cho đến khi cập nhật lại CIDR trên giao diện web của Lightsail.
- **TLS/HTTPS:** Sử dụng chứng chỉ Let's Encrypt qua reverse proxy (Caddy/Nginx).
  - *Giới hạn kỹ thuật:* Việc cấp phát chứng chỉ HTTPS phụ thuộc vào việc bản ghi DNS công khai đã trỏ chính xác về Static IP. Nếu DNS bị trễ hoặc cấu hình sai, HTTPS sẽ không thể khởi tạo tự động.

---

## 6. Kết Luận & Điểm Dừng Gate 4

Hệ thống đã hoàn tất toàn bộ các bước kiểm tra an ninh, vệ sinh mã nguồn, đồng bộ tài liệu và chứng minh qua kiểm thử tự động. 

> [!IMPORTANT]
> **Tuân thủ kỷ luật tiền triển khai (Pre-Deployment Gate):**
> - **DỪNG TẠI GATE 4.**
> - **KHÔNG** tạo VPS Lightsail, **KHÔNG** cấp phát Static IP, **KHÔNG** tạo S3 bucket.
> - **KHÔNG** phát sinh bất kỳ khoản phí nào ($0.00).
> - Chờ chủ sở hữu xác nhận 2 điểm:
>   1. Đã tự kiểm tra tính hợp lệ của $120 credit đối với Lightsail trên AWS Billing Console.
>   2. Quyết định phê duyệt chính thức bằng lệnh để bước sang Gate 5.
