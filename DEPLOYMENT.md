# Hướng dẫn Deploy & Vận hành n8n (Docker Compose)

Tài liệu hướng dẫn triển khai hệ thống n8n kèm đầy đủ các dịch vụ hỗ trợ (PostgreSQL, Redis Cache, SearXNG Web Search, Sandbox Service, External Task Runners và Enterprise License).

---

## 1. Yêu cầu hệ thống

- Đã cài đặt **Docker** (>= 24.0) và **Docker Compose** (>= v2).
- Cổng khả dụng trên máy: `5678` (n8n), `8088` (SearXNG).

---

## 2. Các bước triển khai ban đầu

### Bước 1: Tạo file cấu hình môi trường `.env`
Sao chép từ file mẫu:
```bash
cp .env.example .env
```
*(Trên Windows PowerShell: `Copy-Item .env.example .env`)*

### Bước 2: Chỉnh sửa các thông số quan trọng trong `.env`
Mở file `.env` và cập nhật tối thiểu:
- `DB_POSTGRESDB_PASSWORD`: Đổi mật khẩu database PostgreSQL an toàn.
- `N8N_INSTANCE_AI_MODEL_URL` / `API_KEY` / `MODEL`: Điền thông tin OpenAI-compatible LLM của bạn (nếu dùng Instance AI).
- Giữ nguyên hoặc tùy chỉnh `N8N_VERSION` (khuyến nghị để version cụ thể thay vì `latest`).

### Bước 3: Khởi chạy toàn bộ hệ thống
```bash
docker compose up -d
```

Sau khi chạy, truy cập giao diện n8n tại:
👉 **`http://localhost:5678`** (hoặc IP máy chủ).

---

## 3. Quản lý & Vận hành thường nhật

| Thao tác | Lệnh thực hiện |
| :--- | :--- |
| **Xem trạng thái container** | `docker compose ps` |
| **Xem log n8n theo thời gian thực** | `docker compose logs -f n8n` |
| **Xem log tất cả dịch vụ** | `docker compose logs -f` |
| **Khởi động lại toàn bộ** | `docker compose restart` |
| **Dừng hệ thống (giữ nguyên dữ liệu)** | `docker compose stop` |
| **Xóa container (dữ liệu volume vẫn còn)** | `docker compose down` |

---

## 4. Quy trình nâng cấp version (Hạn chế downtime)

Khi muốn nâng cấp n8n lên phiên bản mới:

1. Mở file `.env`, sửa lại version mong muốn:
   ```env
   N8N_VERSION=2.39.0
   ```
2. Tải trước image mới về máy (hệ thống cũ vẫn chạy, 0s gián đoạn):
   ```bash
   docker compose pull n8n runners
   ```
3. Khởi động lại container với image mới (~3-5 giây gián đoạn):
   ```bash
   docker compose up -d --no-deps n8n runners
   ```
4. Kiểm tra log khởi động và migration database:
   ```bash
   docker compose logs -f n8n
   ```

---

## 5. Dọn dẹp dung lượng (Bảo trì định kỳ)

Sau nhiều lần nâng cấp, các image cũ sẽ tồn đọng trên ổ cứng:

```bash
# Xóa các image rác không tên (<none>)
docker image prune

# Xóa toàn bộ image cũ không còn container nào sử dụng
docker image prune -a
```

---

## 6. Sao lưu dữ liệu (Backup)

Dữ liệu quan trọng nhất nằm trong 2 volume:
1. **`postgres-data`**: Chứa toàn bộ workflows, credentials, user, execution history.
2. **`n8n-data`**: Chứa file mã hóa encryption key (`/home/node/.n8n/config`).

**Lệnh backup nhanh cơ sở dữ liệu PostgreSQL:**
```bash
docker compose exec -T postgres pg_dump -U n8n n8n > n8n_backup_$(date +%Y%m%d).sql
```
*(Trên Windows PowerShell: `docker compose exec -T postgres pg_dump -U n8n n8n | Out-File -Encoding utf8 backup.sql`)*
