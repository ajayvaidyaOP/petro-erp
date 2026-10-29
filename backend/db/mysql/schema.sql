-- ============================================================================
-- PetroFlow ERP — Authoritative MySQL 8.0 Schema (Java 21 API)
-- Applied idempotently at startup by in.petrolflow.Main.
-- ============================================================================
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS `tenants` (
  `id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  `name` VARCHAR(255) NOT NULL,
  `slug` VARCHAR(255) NOT NULL UNIQUE,
  `legal_name` VARCHAR(255),
  `gstin` VARCHAR(255),
  `contact_email` VARCHAR(255),
  `contact_phone` VARCHAR(255),
  `address` TEXT,
  `city` VARCHAR(255),
  `state` VARCHAR(255),
  `status` VARCHAR(255) NOT NULL DEFAULT 'ACTIVE',
  `notes` TEXT,
  `is_demo` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` VARCHAR(40) NOT NULL,
  `updated_at` VARCHAR(40) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `subscription_plans` (
  `id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  `code` VARCHAR(255) NOT NULL UNIQUE,
  `name` VARCHAR(255) NOT NULL,
  `description` TEXT,
  `monthly_price` VARCHAR(255) NOT NULL DEFAULT '0',
  `annual_price` VARCHAR(255) NOT NULL DEFAULT '0',
  `max_stations` INT NOT NULL DEFAULT 1,
  `max_users` INT NOT NULL DEFAULT 5,
  `max_dispensers` INT NOT NULL DEFAULT 4,
  `features` VARCHAR(1024) NOT NULL DEFAULT '[]',
  `trial_days` INT NOT NULL DEFAULT 14,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` VARCHAR(40) NOT NULL,
  `updated_at` VARCHAR(40) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `subscriptions` (
  `id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  `tenant_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `plan_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `status` VARCHAR(255) NOT NULL DEFAULT 'TRIALING',
  `starts_at` VARCHAR(40) NOT NULL,
  `ends_at` VARCHAR(40),
  `trial_ends_at` VARCHAR(40),
  `seats` INT NOT NULL DEFAULT 5,
  `auto_renew` TINYINT(1) NOT NULL DEFAULT 1,
  `notes` TEXT,
  `created_at` VARCHAR(40) NOT NULL,
  `updated_at` VARCHAR(40) NOT NULL,
    CONSTRAINT `fk_subscriptions_tenant_id` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT,
    CONSTRAINT `fk_subscriptions_plan_id` FOREIGN KEY (`plan_id`) REFERENCES `subscription_plans` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @exists := (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'subscriptions' AND index_name = 'idx_subscriptions_tenant');
SET @ddl := IF(@exists = 0, 'ALTER TABLE `subscriptions` ADD INDEX `idx_subscriptions_tenant` (tenant_id, status)', 'DO 0');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS `subscription_invoices` (
  `id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  `tenant_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `subscription_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `invoice_number` VARCHAR(255) NOT NULL UNIQUE,
  `period_start` VARCHAR(255) NOT NULL,
  `period_end` VARCHAR(255) NOT NULL,
  `amount` VARCHAR(255) NOT NULL,
  `tax_amount` VARCHAR(255) NOT NULL DEFAULT '0',
  `total_amount` VARCHAR(255) NOT NULL,
  `status` VARCHAR(255) NOT NULL DEFAULT 'ISSUED',
  `issued_at` VARCHAR(40) NOT NULL,
  `due_at` VARCHAR(40),
  `paid_at` VARCHAR(40),
  `payment_method` VARCHAR(255),
  `payment_reference` VARCHAR(255),
  `notes` TEXT,
  `created_at` VARCHAR(40) NOT NULL,
    CONSTRAINT `fk_subscription_invoices_tenant_id` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT,
    CONSTRAINT `fk_subscription_invoices_subscription_id` FOREIGN KEY (`subscription_id`) REFERENCES `subscriptions` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @exists := (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'subscription_invoices' AND index_name = 'idx_sub_invoices_tenant');
SET @ddl := IF(@exists = 0, 'ALTER TABLE `subscription_invoices` ADD INDEX `idx_sub_invoices_tenant` (tenant_id, status)', 'DO 0');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS `stations` (
  `id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  `tenant_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `code` VARCHAR(255) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `address` TEXT,
  `city` VARCHAR(255),
  `state` VARCHAR(255),
  `pincode` VARCHAR(255),
  `timezone` VARCHAR(255) NOT NULL DEFAULT 'Asia/Kolkata',
  `status` VARCHAR(255) NOT NULL DEFAULT 'ACTIVE',
  `opening_date` DATE,
  `is_demo` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` VARCHAR(40) NOT NULL,
  `updated_at` VARCHAR(40) NOT NULL,
  UNIQUE KEY `uq_stations_tenant_id__code` (tenant_id, code),
    CONSTRAINT `fk_stations_tenant_id` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @exists := (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'stations' AND index_name = 'idx_stations_tenant');
SET @ddl := IF(@exists = 0, 'ALTER TABLE `stations` ADD INDEX `idx_stations_tenant` (tenant_id, status)', 'DO 0');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS `roles` (
  `id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  `key` VARCHAR(255) NOT NULL UNIQUE,
  `name` VARCHAR(255) NOT NULL,
  `description` TEXT,
  `permissions` VARCHAR(2048) NOT NULL DEFAULT '[]',
  `scope` VARCHAR(255) NOT NULL DEFAULT 'STATION',
  `is_system` TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `users` (
  `id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  `tenant_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin,
  `email` VARCHAR(255) NOT NULL UNIQUE,
  `name` VARCHAR(255) NOT NULL,
  `phone` VARCHAR(255),
  `password_hash` VARCHAR(2048) NOT NULL,
  `role_key` VARCHAR(255) NOT NULL,
  `status` VARCHAR(255) NOT NULL DEFAULT 'ACTIVE',
  `must_change_password` TINYINT(1) NOT NULL DEFAULT 0,
  `last_login_at` VARCHAR(40),
  `is_demo` TINYINT(1) NOT NULL DEFAULT 0,
  `granted_permissions` VARCHAR(2048) NOT NULL DEFAULT '[]',
  `created_at` VARCHAR(40) NOT NULL,
  `updated_at` VARCHAR(40) NOT NULL,
    CONSTRAINT `fk_users_tenant_id` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT,
    CONSTRAINT `fk_users_role_key` FOREIGN KEY (`role_key`) REFERENCES `roles` (`key`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @exists := (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'users' AND index_name = 'idx_users_tenant');
SET @ddl := IF(@exists = 0, 'ALTER TABLE `users` ADD INDEX `idx_users_tenant` (tenant_id, status)', 'DO 0');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS `user_station_access` (
  `id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  `user_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `station_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `permissions` VARCHAR(2048) NOT NULL DEFAULT '[]',
  `created_at` VARCHAR(40) NOT NULL,
  UNIQUE KEY `uq_user_station_access_user_id__station_id` (user_id, station_id),
    CONSTRAINT `fk_user_station_access_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_user_station_access_station_id` FOREIGN KEY (`station_id`) REFERENCES `stations` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `sessions` (
  `id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  `user_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `token_hash` VARCHAR(255) NOT NULL UNIQUE,
  `expires_at` VARCHAR(40) NOT NULL,
  `ip` VARCHAR(255),
  `user_agent` VARCHAR(2048),
  `revoked_at` VARCHAR(40),
  `last_seen_at` VARCHAR(40),
  `created_at` VARCHAR(40) NOT NULL,
    CONSTRAINT `fk_sessions_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @exists := (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'sessions' AND index_name = 'idx_sessions_user');
SET @ddl := IF(@exists = 0, 'ALTER TABLE `sessions` ADD INDEX `idx_sessions_user` (user_id, expires_at)', 'DO 0');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS `fuel_products` (
  `id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  `tenant_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `code` VARCHAR(255) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `category` VARCHAR(255) NOT NULL DEFAULT 'PETROL',
  `unit` VARCHAR(255) NOT NULL DEFAULT 'L',
  `color` VARCHAR(255) NOT NULL DEFAULT '#38bdf8',
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `is_demo` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` VARCHAR(40) NOT NULL,
  `updated_at` VARCHAR(40) NOT NULL,
  UNIQUE KEY `uq_fuel_products_tenant_id__code` (tenant_id, code),
    CONSTRAINT `fk_fuel_products_tenant_id` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `fuel_prices` (
  `id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  `tenant_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `product_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `station_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin,
  `rate_per_litre` VARCHAR(255) NOT NULL,
  `effective_from` VARCHAR(255) NOT NULL,
  `effective_to` VARCHAR(255),
  `note` TEXT,
  `created_by` VARCHAR(255),
  `is_demo` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` VARCHAR(40) NOT NULL,
    CONSTRAINT `fk_fuel_prices_tenant_id` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT,
    CONSTRAINT `fk_fuel_prices_product_id` FOREIGN KEY (`product_id`) REFERENCES `fuel_products` (`id`) ON DELETE RESTRICT,
    CONSTRAINT `fk_fuel_prices_station_id` FOREIGN KEY (`station_id`) REFERENCES `stations` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @exists := (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'fuel_prices' AND index_name = 'idx_fuel_prices_product');
SET @ddl := IF(@exists = 0, 'ALTER TABLE `fuel_prices` ADD INDEX `idx_fuel_prices_product` (product_id, effective_from)', 'DO 0');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @exists := (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'fuel_prices' AND index_name = 'idx_fuel_prices_tenant');
SET @ddl := IF(@exists = 0, 'ALTER TABLE `fuel_prices` ADD INDEX `idx_fuel_prices_tenant` (tenant_id, effective_from)', 'DO 0');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @exists := (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'fuel_prices' AND index_name = 'idx_fuel_prices_station');
SET @ddl := IF(@exists = 0, 'ALTER TABLE `fuel_prices` ADD INDEX `idx_fuel_prices_station` (station_id, effective_from)', 'DO 0');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS `tanks` (
  `id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  `station_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `code` VARCHAR(255) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `product_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `capacity_litres` VARCHAR(255) NOT NULL,
  `dead_stock_litres` VARCHAR(255) NOT NULL DEFAULT '0',
  `calibration_reference` VARCHAR(255),
  `status` VARCHAR(255) NOT NULL DEFAULT 'ACTIVE',
  `is_demo` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` VARCHAR(40) NOT NULL,
  `updated_at` VARCHAR(40) NOT NULL,
  UNIQUE KEY `uq_tanks_station_id__code` (station_id, code),
    CONSTRAINT `fk_tanks_station_id` FOREIGN KEY (`station_id`) REFERENCES `stations` (`id`) ON DELETE RESTRICT,
    CONSTRAINT `fk_tanks_product_id` FOREIGN KEY (`product_id`) REFERENCES `fuel_products` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tank_calibration_points` (
  `id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  `tank_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `dip_cm` VARCHAR(255) NOT NULL,
  `litres` VARCHAR(255) NOT NULL,
  UNIQUE KEY `uq_tank_calibration_points_tank_id__dip_cm` (tank_id, dip_cm),
    CONSTRAINT `fk_tank_calibration_points_tank_id` FOREIGN KEY (`tank_id`) REFERENCES `tanks` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tank_measurements` (
  `id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  `tenant_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `station_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `tank_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `measured_at` VARCHAR(40) NOT NULL,
  `dip_cm` VARCHAR(255),
  `water_dip_cm` VARCHAR(255),
  `measured_litres` VARCHAR(255) NOT NULL,
  `book_stock_litres` VARCHAR(255) NOT NULL,
  `variance_litres` VARCHAR(255) NOT NULL,
  `method` VARCHAR(255) NOT NULL DEFAULT 'MANUAL',
  `source` VARCHAR(255),
  `entered_by` VARCHAR(255),
  `note` TEXT,
  `is_demo` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` VARCHAR(40) NOT NULL,
    CONSTRAINT `fk_tank_measurements_tenant_id` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT,
    CONSTRAINT `fk_tank_measurements_station_id` FOREIGN KEY (`station_id`) REFERENCES `stations` (`id`) ON DELETE RESTRICT,
    CONSTRAINT `fk_tank_measurements_tank_id` FOREIGN KEY (`tank_id`) REFERENCES `tanks` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @exists := (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'tank_measurements' AND index_name = 'idx_tank_measurements_tank');
SET @ddl := IF(@exists = 0, 'ALTER TABLE `tank_measurements` ADD INDEX `idx_tank_measurements_tank` (tank_id, measured_at)', 'DO 0');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS `dispensers` (
  `id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  `station_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `code` VARCHAR(255) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `model` VARCHAR(255),
  `serial_number` VARCHAR(255) NOT NULL,
  `protocol` VARCHAR(255),
  `status` VARCHAR(255) NOT NULL DEFAULT 'ACTIVE',
  `is_demo` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` VARCHAR(40) NOT NULL,
  `updated_at` VARCHAR(40) NOT NULL,
  UNIQUE KEY `uq_dispensers_station_id__code` (station_id, code),
  UNIQUE KEY `uq_dispensers_station_id__serial_number` (station_id, serial_number),
    CONSTRAINT `fk_dispensers_station_id` FOREIGN KEY (`station_id`) REFERENCES `stations` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `nozzles` (
  `id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  `station_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `dispenser_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `product_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `tank_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin,
  `number` INT NOT NULL,
  `label` VARCHAR(255) NOT NULL,
  `totalizer_unit` VARCHAR(255) NOT NULL DEFAULT 'L',
  `status` VARCHAR(255) NOT NULL DEFAULT 'ACTIVE',
  `is_demo` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` VARCHAR(40) NOT NULL,
  `updated_at` VARCHAR(40) NOT NULL,
  UNIQUE KEY `uq_nozzles_dispenser_id__number` (dispenser_id, number),
    CONSTRAINT `fk_nozzles_station_id` FOREIGN KEY (`station_id`) REFERENCES `stations` (`id`) ON DELETE RESTRICT,
    CONSTRAINT `fk_nozzles_dispenser_id` FOREIGN KEY (`dispenser_id`) REFERENCES `dispensers` (`id`) ON DELETE RESTRICT,
    CONSTRAINT `fk_nozzles_product_id` FOREIGN KEY (`product_id`) REFERENCES `fuel_products` (`id`) ON DELETE RESTRICT,
    CONSTRAINT `fk_nozzles_tank_id` FOREIGN KEY (`tank_id`) REFERENCES `tanks` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `hardware_devices` (
  `id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  `tenant_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `station_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `code` VARCHAR(255) NOT NULL UNIQUE,
  `name` VARCHAR(255) NOT NULL,
  `type` VARCHAR(255) NOT NULL DEFAULT 'GATEWAY',
  `vendor` VARCHAR(255),
  `model` VARCHAR(255),
  `serial_number` VARCHAR(255),
  `protocol` VARCHAR(255),
  `status` VARCHAR(255) NOT NULL DEFAULT 'OFFLINE',
  `api_key_hash` VARCHAR(255) NOT NULL,
  `api_key_prefix` VARCHAR(255) NOT NULL,
  `key_version` INT NOT NULL DEFAULT 1,
  `last_heartbeat_at` VARCHAR(40),
  `last_sync_at` VARCHAR(40),
  `firmware_version` VARCHAR(255),
  `is_simulated` TINYINT(1) NOT NULL DEFAULT 1,
  `notes` TEXT,
  `created_at` VARCHAR(40) NOT NULL,
  `updated_at` VARCHAR(40) NOT NULL,
    CONSTRAINT `fk_hardware_devices_tenant_id` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT,
    CONSTRAINT `fk_hardware_devices_station_id` FOREIGN KEY (`station_id`) REFERENCES `stations` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @exists := (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'hardware_devices' AND index_name = 'idx_devices_station');
SET @ddl := IF(@exists = 0, 'ALTER TABLE `hardware_devices` ADD INDEX `idx_devices_station` (station_id, status)', 'DO 0');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS `device_credentials` (
  `id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  `device_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `key_prefix` VARCHAR(255) NOT NULL,
  `secret_hash` VARCHAR(255) NOT NULL,
  `version` INT NOT NULL,
  `status` VARCHAR(255) NOT NULL DEFAULT 'ACTIVE',
  `created_by` VARCHAR(255),
  `created_at` VARCHAR(40) NOT NULL,
  `rotated_at` VARCHAR(40),
  `revoked_at` VARCHAR(40),
  UNIQUE KEY `uq_device_credentials_device_id__version` (device_id, version),
    CONSTRAINT `fk_device_credentials_device_id` FOREIGN KEY (`device_id`) REFERENCES `hardware_devices` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `device_events` (
  `id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  `tenant_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `station_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `device_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `event_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `event_type` VARCHAR(255) NOT NULL,
  `sequence` INT NOT NULL DEFAULT 0,
  `occurred_at` VARCHAR(40) NOT NULL,
  `received_at` VARCHAR(40) NOT NULL,
  `payload` TEXT NOT NULL,
  `payload_hash` VARCHAR(255) NOT NULL,
  `status` VARCHAR(255) NOT NULL DEFAULT 'RECEIVED',
  `error` VARCHAR(255),
  `processed_at` VARCHAR(40),
  `source_ip` VARCHAR(255),
  UNIQUE KEY `uq_device_events_device_id__event_id` (device_id, event_id),
    CONSTRAINT `fk_device_events_tenant_id` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT,
    CONSTRAINT `fk_device_events_station_id` FOREIGN KEY (`station_id`) REFERENCES `stations` (`id`) ON DELETE RESTRICT,
    CONSTRAINT `fk_device_events_device_id` FOREIGN KEY (`device_id`) REFERENCES `hardware_devices` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @exists := (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'device_events' AND index_name = 'idx_device_events_status');
SET @ddl := IF(@exists = 0, 'ALTER TABLE `device_events` ADD INDEX `idx_device_events_status` (device_id, status)', 'DO 0');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @exists := (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'device_events' AND index_name = 'idx_device_events_station');
SET @ddl := IF(@exists = 0, 'ALTER TABLE `device_events` ADD INDEX `idx_device_events_station` (station_id, received_at)', 'DO 0');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS `device_error_logs` (
  `id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  `device_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `station_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `code` VARCHAR(255) NOT NULL,
  `message` TEXT NOT NULL,
  `detail` TEXT,
  `created_at` VARCHAR(40) NOT NULL,
  `resolved_at` VARCHAR(40),
    CONSTRAINT `fk_device_error_logs_device_id` FOREIGN KEY (`device_id`) REFERENCES `hardware_devices` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_device_error_logs_station_id` FOREIGN KEY (`station_id`) REFERENCES `stations` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @exists := (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'device_error_logs' AND index_name = 'idx_device_errors_device');
SET @ddl := IF(@exists = 0, 'ALTER TABLE `device_error_logs` ADD INDEX `idx_device_errors_device` (device_id, created_at)', 'DO 0');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS `meter_readings` (
  `id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  `tenant_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `station_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `nozzle_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `device_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin,
  `device_event_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin UNIQUE,
  `reading_value` VARCHAR(255) NOT NULL,
  `unit` VARCHAR(255) NOT NULL,
  `source` VARCHAR(255) NOT NULL DEFAULT 'DEVICE',
  `quality` VARCHAR(255) NOT NULL DEFAULT 'VALID',
  `reading_at` VARCHAR(40) NOT NULL,
  `sequence` INT NOT NULL DEFAULT 0,
  `delta_litres` VARCHAR(255),
  `previous_reading_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin,
  `is_countable` TINYINT(1) NOT NULL DEFAULT 1,
  `is_simulated` TINYINT(1) NOT NULL DEFAULT 0,
  `note` TEXT,
  `created_by` VARCHAR(255),
  `created_at` VARCHAR(40) NOT NULL,
    CONSTRAINT `fk_meter_readings_tenant_id` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT,
    CONSTRAINT `fk_meter_readings_station_id` FOREIGN KEY (`station_id`) REFERENCES `stations` (`id`) ON DELETE RESTRICT,
    CONSTRAINT `fk_meter_readings_nozzle_id` FOREIGN KEY (`nozzle_id`) REFERENCES `nozzles` (`id`) ON DELETE RESTRICT,
    CONSTRAINT `fk_meter_readings_device_id` FOREIGN KEY (`device_id`) REFERENCES `hardware_devices` (`id`) ON DELETE SET NULL,
    CONSTRAINT `fk_meter_readings_device_event_id` FOREIGN KEY (`device_event_id`) REFERENCES `device_events` (`id`) ON DELETE SET NULL,
    CONSTRAINT `fk_meter_readings_previous_reading_id` FOREIGN KEY (`previous_reading_id`) REFERENCES `meter_readings` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @exists := (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'meter_readings' AND index_name = 'idx_meter_readings_nozzle');
SET @ddl := IF(@exists = 0, 'ALTER TABLE `meter_readings` ADD INDEX `idx_meter_readings_nozzle` (nozzle_id, reading_at)', 'DO 0');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @exists := (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'meter_readings' AND index_name = 'idx_meter_readings_station');
SET @ddl := IF(@exists = 0, 'ALTER TABLE `meter_readings` ADD INDEX `idx_meter_readings_station` (station_id, reading_at)', 'DO 0');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS `shifts` (
  `id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  `tenant_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `station_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `shift_number` INT NOT NULL,
  `business_date` DATE NOT NULL,
  `opened_at` VARCHAR(40) NOT NULL,
  `closed_at` VARCHAR(40),
  `operator_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin,
  `opened_by` VARCHAR(255),
  `closed_by` VARCHAR(255),
  `status` VARCHAR(255) NOT NULL DEFAULT 'OPEN',
  `total_litres` VARCHAR(255) NOT NULL DEFAULT '0',
  `total_value` VARCHAR(255) NOT NULL DEFAULT '0',
  `opening_cash` VARCHAR(255) NOT NULL DEFAULT '0',
  `closing_cash` VARCHAR(255) NOT NULL DEFAULT '0',
  `cash_counted` VARCHAR(255),
  `short_excess` VARCHAR(255),
  `notes` TEXT,
  `close_notes` TEXT,
  `approved_by` VARCHAR(255),
  `approved_at` VARCHAR(40),
  `is_demo` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` VARCHAR(40) NOT NULL,
  `updated_at` VARCHAR(40) NOT NULL,
  UNIQUE KEY `uq_shifts_station_id__business_date__shift_number` (station_id, business_date, shift_number),
    CONSTRAINT `fk_shifts_tenant_id` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT,
    CONSTRAINT `fk_shifts_station_id` FOREIGN KEY (`station_id`) REFERENCES `stations` (`id`) ON DELETE RESTRICT,
    CONSTRAINT `fk_shifts_operator_id` FOREIGN KEY (`operator_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
    CONSTRAINT `fk_shifts_opened_by` FOREIGN KEY (`opened_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
    CONSTRAINT `fk_shifts_closed_by` FOREIGN KEY (`closed_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
    CONSTRAINT `fk_shifts_approved_by` FOREIGN KEY (`approved_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @exists := (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'shifts' AND index_name = 'idx_shifts_station');
SET @ddl := IF(@exists = 0, 'ALTER TABLE `shifts` ADD INDEX `idx_shifts_station` (station_id, business_date)', 'DO 0');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS `shift_nozzle_readings` (
  `id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  `shift_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `nozzle_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `opening_reading` VARCHAR(255),
  `closing_reading` VARCHAR(255),
  `opening_reading_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin,
  `closing_reading_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin,
  `opening_source` VARCHAR(255),
  `closing_source` VARCHAR(255),
  `litres_sold` VARCHAR(255),
  `testing_litres` VARCHAR(255) NOT NULL DEFAULT '0',
  `operator_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin,
  `rate` VARCHAR(255),
  `sales_value` VARCHAR(255),
  `variance_litres` VARCHAR(255),
  `adjustment_litres` VARCHAR(255) NOT NULL DEFAULT '0',
  `adjustment_reason` TEXT,
  `status` VARCHAR(255) NOT NULL DEFAULT 'PENDING',
  `note` TEXT,
  `created_at` VARCHAR(40) NOT NULL,
  `updated_at` VARCHAR(40) NOT NULL,
  UNIQUE KEY `uq_shift_nozzle_readings_shift_id__nozzle_id` (shift_id, nozzle_id),
    CONSTRAINT `fk_shift_nozzle_readings_shift_id` FOREIGN KEY (`shift_id`) REFERENCES `shifts` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_shift_nozzle_readings_nozzle_id` FOREIGN KEY (`nozzle_id`) REFERENCES `nozzles` (`id`) ON DELETE RESTRICT,
    CONSTRAINT `fk_shift_nozzle_readings_opening_reading_id` FOREIGN KEY (`opening_reading_id`) REFERENCES `meter_readings` (`id`) ON DELETE SET NULL,
    CONSTRAINT `fk_shift_nozzle_readings_closing_reading_id` FOREIGN KEY (`closing_reading_id`) REFERENCES `meter_readings` (`id`) ON DELETE SET NULL,
    CONSTRAINT `fk_shift_nozzle_readings_operator_id` FOREIGN KEY (`operator_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @exists := (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'shift_nozzle_readings' AND index_name = 'idx_shift_nozzles_shift');
SET @ddl := IF(@exists = 0, 'ALTER TABLE `shift_nozzle_readings` ADD INDEX `idx_shift_nozzles_shift` (shift_id)', 'DO 0');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS `fuel_transactions` (
  `id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  `tenant_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `station_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `shift_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin,
  `nozzle_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin,
  `product_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `quantity_litres` VARCHAR(255) NOT NULL,
  `rate` VARCHAR(255) NOT NULL,
  `amount` VARCHAR(255) NOT NULL,
  `payment_mode` VARCHAR(255) NOT NULL DEFAULT 'CASH',
  `customer_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin,
  `occurred_at` VARCHAR(40) NOT NULL,
  `reference` VARCHAR(255),
  `source` VARCHAR(255) NOT NULL DEFAULT 'MANUAL',
  `is_estimated` TINYINT(1) NOT NULL DEFAULT 0,
  `is_demo` TINYINT(1) NOT NULL DEFAULT 0,
  `created_by` VARCHAR(255),
  `reversal_of` VARCHAR(255),
  `voided_at` VARCHAR(40),
  `void_reason` TEXT,
  `note` TEXT,
  `created_at` VARCHAR(40) NOT NULL,
  UNIQUE KEY `uq_fuel_transactions_tenant_id__reference` (tenant_id, reference),
    CONSTRAINT `fk_fuel_transactions_tenant_id` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT,
    CONSTRAINT `fk_fuel_transactions_station_id` FOREIGN KEY (`station_id`) REFERENCES `stations` (`id`) ON DELETE RESTRICT,
    CONSTRAINT `fk_fuel_transactions_shift_id` FOREIGN KEY (`shift_id`) REFERENCES `shifts` (`id`) ON DELETE RESTRICT,
    CONSTRAINT `fk_fuel_transactions_nozzle_id` FOREIGN KEY (`nozzle_id`) REFERENCES `nozzles` (`id`) ON DELETE RESTRICT,
    CONSTRAINT `fk_fuel_transactions_product_id` FOREIGN KEY (`product_id`) REFERENCES `fuel_products` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @exists := (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'fuel_transactions' AND index_name = 'idx_fuel_tx_station');
SET @ddl := IF(@exists = 0, 'ALTER TABLE `fuel_transactions` ADD INDEX `idx_fuel_tx_station` (station_id, occurred_at)', 'DO 0');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @exists := (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'fuel_transactions' AND index_name = 'idx_fuel_tx_shift');
SET @ddl := IF(@exists = 0, 'ALTER TABLE `fuel_transactions` ADD INDEX `idx_fuel_tx_shift` (shift_id)', 'DO 0');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS `suppliers` (
  `id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  `tenant_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `code` VARCHAR(255) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `gstin` VARCHAR(255),
  `contact_person` VARCHAR(255),
  `phone` VARCHAR(255),
  `email` VARCHAR(255),
  `address` TEXT,
  `credit_days` INT NOT NULL DEFAULT 0,
  `opening_balance` VARCHAR(255) NOT NULL DEFAULT '0',
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `is_demo` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` VARCHAR(40) NOT NULL,
  `updated_at` VARCHAR(40) NOT NULL,
  UNIQUE KEY `uq_suppliers_tenant_id__code` (tenant_id, code),
    CONSTRAINT `fk_suppliers_tenant_id` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `deliveries` (
  `id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  `tenant_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `station_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `supplier_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `invoice_number` VARCHAR(255) NOT NULL,
  `invoice_date` DATE NOT NULL,
  `product_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `tank_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `quantity_litres` VARCHAR(255) NOT NULL,
  `received_litres` VARCHAR(255),
  `rate_per_litre` VARCHAR(255) NOT NULL,
  `taxable_amount` VARCHAR(255) NOT NULL,
  `tax_amount` VARCHAR(255) NOT NULL DEFAULT '0',
  `total_amount` VARCHAR(255) NOT NULL,
  `status` VARCHAR(255) NOT NULL DEFAULT 'DRAFT',
  `received_at` VARCHAR(40),
  `vehicle_number` VARCHAR(255),
  `driver_name` VARCHAR(255),
  `dip_before_cm` VARCHAR(255),
  `dip_after_cm` VARCHAR(255),
  `density_invoice` VARCHAR(255),
  `density_observed` VARCHAR(255),
  `temp_observed_c` VARCHAR(255),
  `density_at_15c` VARCHAR(255),
  `tt_seal_numbers` VARCHAR(255),
  `sample_seal_no` VARCHAR(255),
  `chamber_details` TEXT,
  `notes` TEXT,
  `is_demo` TINYINT(1) NOT NULL DEFAULT 0,
  `created_by` VARCHAR(255),
  `created_at` VARCHAR(40) NOT NULL,
  `updated_at` VARCHAR(40) NOT NULL,
  UNIQUE KEY `uq_deliveries_tenant_id__supplier_id__invoice_number` (tenant_id, supplier_id, invoice_number),
    CONSTRAINT `fk_deliveries_tenant_id` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT,
    CONSTRAINT `fk_deliveries_station_id` FOREIGN KEY (`station_id`) REFERENCES `stations` (`id`) ON DELETE RESTRICT,
    CONSTRAINT `fk_deliveries_supplier_id` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers` (`id`) ON DELETE RESTRICT,
    CONSTRAINT `fk_deliveries_product_id` FOREIGN KEY (`product_id`) REFERENCES `fuel_products` (`id`) ON DELETE RESTRICT,
    CONSTRAINT `fk_deliveries_tank_id` FOREIGN KEY (`tank_id`) REFERENCES `tanks` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @exists := (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'deliveries' AND index_name = 'idx_deliveries_station');
SET @ddl := IF(@exists = 0, 'ALTER TABLE `deliveries` ADD INDEX `idx_deliveries_station` (station_id, invoice_date)', 'DO 0');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS `stock_movements` (
  `id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  `tenant_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `station_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `tank_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `product_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `type` VARCHAR(255) NOT NULL,
  `quantity_litres` VARCHAR(255) NOT NULL,
  `reference_type` VARCHAR(255),
  `reference_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin,
  `occurred_at` VARCHAR(40) NOT NULL,
  `note` TEXT,
  `created_by` VARCHAR(255),
  `is_demo` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` VARCHAR(40) NOT NULL,
    CONSTRAINT `fk_stock_movements_tenant_id` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT,
    CONSTRAINT `fk_stock_movements_station_id` FOREIGN KEY (`station_id`) REFERENCES `stations` (`id`) ON DELETE RESTRICT,
    CONSTRAINT `fk_stock_movements_tank_id` FOREIGN KEY (`tank_id`) REFERENCES `tanks` (`id`) ON DELETE RESTRICT,
    CONSTRAINT `fk_stock_movements_product_id` FOREIGN KEY (`product_id`) REFERENCES `fuel_products` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @exists := (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'stock_movements' AND index_name = 'idx_stock_movements_tank');
SET @ddl := IF(@exists = 0, 'ALTER TABLE `stock_movements` ADD INDEX `idx_stock_movements_tank` (tank_id, occurred_at)', 'DO 0');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @exists := (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'stock_movements' AND index_name = 'idx_stock_movements_ref');
SET @ddl := IF(@exists = 0, 'ALTER TABLE `stock_movements` ADD INDEX `idx_stock_movements_ref` (reference_type, reference_id)', 'DO 0');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS `customers` (
  `id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  `tenant_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `code` VARCHAR(255) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `phone` VARCHAR(255),
  `email` VARCHAR(255),
  `gstin` VARCHAR(255),
  `address` TEXT,
  `credit_limit` VARCHAR(255) NOT NULL DEFAULT '0',
  `credit_days` INT NOT NULL DEFAULT 0,
  `balance` VARCHAR(255) NOT NULL DEFAULT '0',
  `status` VARCHAR(255) NOT NULL DEFAULT 'ACTIVE',
  `is_demo` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` VARCHAR(40) NOT NULL,
  `updated_at` VARCHAR(40) NOT NULL,
  UNIQUE KEY `uq_customers_tenant_id__code` (tenant_id, code),
    CONSTRAINT `fk_customers_tenant_id` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `credit_entries` (
  `id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  `tenant_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `station_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `customer_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `type` VARCHAR(255) NOT NULL,
  `amount` VARCHAR(255) NOT NULL,
  `slip_number` VARCHAR(255),
  `vehicle_number` VARCHAR(255),
  `driver_name` VARCHAR(255),
  `product_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin,
  `quantity_litres` VARCHAR(255),
  `rate_per_litre` VARCHAR(255),
  `reference` VARCHAR(255),
  `occurred_at` VARCHAR(40) NOT NULL,
  `due_date` DATE,
  `transaction_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin,
  `payment_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin,
  `note` TEXT,
  `status` VARCHAR(255) NOT NULL DEFAULT 'POSTED',
  `created_by` VARCHAR(255),
  `created_at` VARCHAR(40) NOT NULL,
    CONSTRAINT `fk_credit_entries_tenant_id` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT,
    CONSTRAINT `fk_credit_entries_station_id` FOREIGN KEY (`station_id`) REFERENCES `stations` (`id`) ON DELETE RESTRICT,
    CONSTRAINT `fk_credit_entries_customer_id` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`) ON DELETE RESTRICT,
    CONSTRAINT `fk_credit_entries_product_id` FOREIGN KEY (`product_id`) REFERENCES `fuel_products` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @exists := (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'credit_entries' AND index_name = 'idx_credit_entries_customer');
SET @ddl := IF(@exists = 0, 'ALTER TABLE `credit_entries` ADD INDEX `idx_credit_entries_customer` (customer_id, occurred_at)', 'DO 0');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS `payments` (
  `id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  `tenant_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `station_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `direction` VARCHAR(255) NOT NULL,
  `party_type` VARCHAR(255) NOT NULL,
  `customer_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin,
  `supplier_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin,
  `amount` VARCHAR(255) NOT NULL,
  `mode` VARCHAR(255) NOT NULL DEFAULT 'CASH',
  `reference` VARCHAR(255),
  `occurred_at` VARCHAR(40) NOT NULL,
  `status` VARCHAR(255) NOT NULL DEFAULT 'POSTED',
  `settlement_ref` VARCHAR(255),
  `settled_at` VARCHAR(40),
  `notes` TEXT,
  `created_by` VARCHAR(255),
  `is_demo` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` VARCHAR(40) NOT NULL,
  UNIQUE KEY `uq_payments_tenant_id__reference` (tenant_id, reference),
    CONSTRAINT `fk_payments_tenant_id` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT,
    CONSTRAINT `fk_payments_station_id` FOREIGN KEY (`station_id`) REFERENCES `stations` (`id`) ON DELETE RESTRICT,
    CONSTRAINT `fk_payments_customer_id` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`) ON DELETE RESTRICT,
    CONSTRAINT `fk_payments_supplier_id` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @exists := (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'payments' AND index_name = 'idx_payments_station');
SET @ddl := IF(@exists = 0, 'ALTER TABLE `payments` ADD INDEX `idx_payments_station` (station_id, occurred_at)', 'DO 0');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS `expense_categories` (
  `id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  `tenant_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY `uq_expense_categories_tenant_id__name` (tenant_id, name),
    CONSTRAINT `fk_expense_categories_tenant_id` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `expenses` (
  `id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  `tenant_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `station_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `category_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin,
  `category_name` VARCHAR(255) NOT NULL,
  `description` TEXT NOT NULL,
  `amount` VARCHAR(255) NOT NULL,
  `occurred_at` VARCHAR(40) NOT NULL,
  `paid_via` VARCHAR(255) NOT NULL DEFAULT 'CASH',
  `reference` VARCHAR(255),
  `note` TEXT,
  `created_by` VARCHAR(255),
  `is_demo` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` VARCHAR(40) NOT NULL,
    CONSTRAINT `fk_expenses_tenant_id` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT,
    CONSTRAINT `fk_expenses_station_id` FOREIGN KEY (`station_id`) REFERENCES `stations` (`id`) ON DELETE RESTRICT,
    CONSTRAINT `fk_expenses_category_id` FOREIGN KEY (`category_id`) REFERENCES `expense_categories` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @exists := (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'expenses' AND index_name = 'idx_expenses_station');
SET @ddl := IF(@exists = 0, 'ALTER TABLE `expenses` ADD INDEX `idx_expenses_station` (station_id, occurred_at)', 'DO 0');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS `reconciliations` (
  `id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  `tenant_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `station_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `business_date` DATE NOT NULL,
  `type` VARCHAR(255) NOT NULL DEFAULT 'CASH',
  `shift_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin,
  `cash_expected` VARCHAR(255) NOT NULL DEFAULT '0',
  `cash_counted` VARCHAR(255) NOT NULL DEFAULT '0',
  `digital_expected` VARCHAR(255) NOT NULL DEFAULT '0',
  `digital_settled` VARCHAR(255) NOT NULL DEFAULT '0',
  `variance` VARCHAR(255) NOT NULL DEFAULT '0',
  `status` VARCHAR(255) NOT NULL DEFAULT 'OPEN',
  `notes` TEXT,
  `created_by` VARCHAR(255),
  `approved_by` VARCHAR(255),
  `approved_at` VARCHAR(40),
  `created_at` VARCHAR(40) NOT NULL,
    CONSTRAINT `fk_reconciliations_tenant_id` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT,
    CONSTRAINT `fk_reconciliations_station_id` FOREIGN KEY (`station_id`) REFERENCES `stations` (`id`) ON DELETE RESTRICT,
    CONSTRAINT `fk_reconciliations_shift_id` FOREIGN KEY (`shift_id`) REFERENCES `shifts` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @exists := (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'reconciliations' AND index_name = 'idx_reconciliations_station');
SET @ddl := IF(@exists = 0, 'ALTER TABLE `reconciliations` ADD INDEX `idx_reconciliations_station` (station_id, business_date)', 'DO 0');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS `audit_logs` (
  `id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  `tenant_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin,
  `station_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin,
  `actor_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin,
  `actor_email` VARCHAR(255),
  `actor_role` VARCHAR(255),
  `action` VARCHAR(255) NOT NULL,
  `entity` VARCHAR(255) NOT NULL,
  `entity_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin,
  `summary` TEXT,
  `before_data` TEXT,
  `after_data` TEXT,
  `ip` VARCHAR(255),
  `user_agent` VARCHAR(2048),
  `is_demo` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` VARCHAR(40) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @exists := (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'audit_logs' AND index_name = 'idx_audit_tenant');
SET @ddl := IF(@exists = 0, 'ALTER TABLE `audit_logs` ADD INDEX `idx_audit_tenant` (tenant_id, created_at)', 'DO 0');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @exists := (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'audit_logs' AND index_name = 'idx_audit_entity');
SET @ddl := IF(@exists = 0, 'ALTER TABLE `audit_logs` ADD INDEX `idx_audit_entity` (entity, entity_id)', 'DO 0');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS `idempotency_keys` (
  `id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  `tenant_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `scope` VARCHAR(255) NOT NULL,
  `key` VARCHAR(255) NOT NULL,
  `request_hash` VARCHAR(255) NOT NULL,
  `status` VARCHAR(255) NOT NULL DEFAULT 'COMPLETED',
  `response_status` INT,
  `response_body` TEXT,
  `created_at` VARCHAR(40) NOT NULL,
  `expires_at` VARCHAR(40) NOT NULL,
  UNIQUE KEY `uq_idempotency_keys_tenant_id__scope__key` (tenant_id, scope, key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `app_settings` (
  `id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  `tenant_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT '',
  `station_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT '',
  `key` VARCHAR(255) NOT NULL,
  `value` VARCHAR(255),
  `updated_by` VARCHAR(255),
  `updated_at` VARCHAR(40) NOT NULL,
  UNIQUE KEY `uq_app_settings_tenant_id__station_id__key` (tenant_id, station_id, key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `platform_errors` (
  `id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  `tenant_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin,
  `source` VARCHAR(255) NOT NULL,
  `message` TEXT NOT NULL,
  `detail` TEXT,
  `path` VARCHAR(255),
  `severity` VARCHAR(255) NOT NULL DEFAULT 'ERROR',
  `created_at` VARCHAR(40) NOT NULL,
  `resolved_at` VARCHAR(40)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @exists := (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'platform_errors' AND index_name = 'idx_platform_errors_created');
SET @ddl := IF(@exists = 0, 'ALTER TABLE `platform_errors` ADD INDEX `idx_platform_errors_created` (created_at)', 'DO 0');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS `density_checks` (
  `id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  `tenant_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `station_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `tank_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `product_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `business_date` DATE NOT NULL,
  `checked_at` VARCHAR(40) NOT NULL,
  `observed_density` VARCHAR(255) NOT NULL,
  `observed_temp_c` VARCHAR(255) NOT NULL,
  `density_at_15c` VARCHAR(255) NOT NULL,
  `spec_min` VARCHAR(255),
  `spec_max` VARCHAR(255),
  `within_spec` TINYINT(1) NOT NULL DEFAULT 1,
  `source` VARCHAR(255) NOT NULL DEFAULT 'NOZZLE',
  `checked_by` VARCHAR(255),
  `note` TEXT,
  `is_demo` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` VARCHAR(40) NOT NULL,
    CONSTRAINT `fk_density_checks_tenant_id` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT,
    CONSTRAINT `fk_density_checks_station_id` FOREIGN KEY (`station_id`) REFERENCES `stations` (`id`) ON DELETE RESTRICT,
    CONSTRAINT `fk_density_checks_tank_id` FOREIGN KEY (`tank_id`) REFERENCES `tanks` (`id`) ON DELETE RESTRICT,
    CONSTRAINT `fk_density_checks_product_id` FOREIGN KEY (`product_id`) REFERENCES `fuel_products` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @exists := (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'density_checks' AND index_name = 'idx_density_station_date');
SET @ddl := IF(@exists = 0, 'ALTER TABLE `density_checks` ADD INDEX `idx_density_station_date` (station_id, business_date)', 'DO 0');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS `shift_cash_denominations` (
  `id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  `shift_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `denomination` INT NOT NULL,
  `count` INT NOT NULL DEFAULT 0,
  `amount` VARCHAR(255) NOT NULL DEFAULT '0',
  UNIQUE KEY `uq_shift_cash_denominations_shift_id__denomination` (shift_id, denomination),
    CONSTRAINT `fk_shift_cash_denominations_shift_id` FOREIGN KEY (`shift_id`) REFERENCES `shifts` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `shift_settlements` (
  `id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  `shift_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `tenant_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `station_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `mode` VARCHAR(255) NOT NULL,
  `expected_amount` VARCHAR(255) NOT NULL DEFAULT '0',
  `received_amount` VARCHAR(255),
  `difference_amount` VARCHAR(255),
  `note` TEXT,
  `created_at` VARCHAR(40) NOT NULL,
  UNIQUE KEY `uq_shift_settlements_shift_id__mode` (shift_id, mode),
    CONSTRAINT `fk_shift_settlements_shift_id` FOREIGN KEY (`shift_id`) REFERENCES `shifts` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_shift_settlements_tenant_id` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT,
    CONSTRAINT `fk_shift_settlements_station_id` FOREIGN KEY (`station_id`) REFERENCES `stations` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @exists := (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'shift_settlements' AND index_name = 'idx_shift_settlements_shift');
SET @ddl := IF(@exists = 0, 'ALTER TABLE `shift_settlements` ADD INDEX `idx_shift_settlements_shift` (shift_id)', 'DO 0');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS `day_closings` (
  `id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  `tenant_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `station_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `business_date` DATE NOT NULL,
  `status` VARCHAR(255) NOT NULL DEFAULT 'CLOSED',
  `closed_by` VARCHAR(255),
  `closed_at` VARCHAR(40) NOT NULL,
  `reopened_by` VARCHAR(255),
  `reopened_at` VARCHAR(40),
  `reopen_reason` TEXT,
  `notes` TEXT,
  `created_at` VARCHAR(40) NOT NULL,
  UNIQUE KEY `uq_day_closings_station_id__business_date` (station_id, business_date),
    CONSTRAINT `fk_day_closings_tenant_id` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT,
    CONSTRAINT `fk_day_closings_station_id` FOREIGN KEY (`station_id`) REFERENCES `stations` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @exists := (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'day_closings' AND index_name = 'idx_day_closings_station');
SET @ddl := IF(@exists = 0, 'ALTER TABLE `day_closings` ADD INDEX `idx_day_closings_station` (station_id, business_date)', 'DO 0');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS `customer_vehicles` (
  `id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  `tenant_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `customer_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `vehicle_number` VARCHAR(255) NOT NULL,
  `vehicle_type` VARCHAR(255),
  `driver_name` VARCHAR(255),
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` VARCHAR(40) NOT NULL,
  `updated_at` VARCHAR(40) NOT NULL,
  UNIQUE KEY `uq_customer_vehicles_customer_id__vehicle_number` (customer_id, vehicle_number),
    CONSTRAINT `fk_customer_vehicles_tenant_id` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT,
    CONSTRAINT `fk_customer_vehicles_customer_id` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @exists := (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'customer_vehicles' AND index_name = 'idx_vehicles_customer');
SET @ddl := IF(@exists = 0, 'ALTER TABLE `customer_vehicles` ADD INDEX `idx_vehicles_customer` (customer_id)', 'DO 0');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS `compliance_documents` (
  `id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  `tenant_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `station_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `dispenser_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin,
  `tank_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin,
  `doc_type` VARCHAR(255) NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `doc_number` VARCHAR(255),
  `authority` VARCHAR(255),
  `issued_on` DATE,
  `expires_on` DATE NOT NULL,
  `renewal_lead_days` INT NOT NULL DEFAULT 30,
  `notes` TEXT,
  `is_demo` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` VARCHAR(40) NOT NULL,
  `updated_at` VARCHAR(40) NOT NULL,
    CONSTRAINT `fk_compliance_documents_tenant_id` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT,
    CONSTRAINT `fk_compliance_documents_station_id` FOREIGN KEY (`station_id`) REFERENCES `stations` (`id`) ON DELETE RESTRICT,
    CONSTRAINT `fk_compliance_documents_dispenser_id` FOREIGN KEY (`dispenser_id`) REFERENCES `dispensers` (`id`) ON DELETE SET NULL,
    CONSTRAINT `fk_compliance_documents_tank_id` FOREIGN KEY (`tank_id`) REFERENCES `tanks` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @exists := (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'compliance_documents' AND index_name = 'idx_compliance_station');
SET @ddl := IF(@exists = 0, 'ALTER TABLE `compliance_documents` ADD INDEX `idx_compliance_station` (station_id, expires_on)', 'DO 0');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS `lube_products` (
  `id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  `tenant_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `code` VARCHAR(255) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `brand` VARCHAR(255),
  `pack_size` VARCHAR(255) NOT NULL DEFAULT '1 L',
  `hsn_code` VARCHAR(255),
  `gst_rate_pct` VARCHAR(255) NOT NULL DEFAULT '18',
  `purchase_rate` VARCHAR(255) NOT NULL DEFAULT '0',
  `sale_rate` VARCHAR(255) NOT NULL DEFAULT '0',
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `is_demo` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` VARCHAR(40) NOT NULL,
  `updated_at` VARCHAR(40) NOT NULL,
  UNIQUE KEY `uq_lube_products_tenant_id__code` (tenant_id, code),
    CONSTRAINT `fk_lube_products_tenant_id` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `lube_movements` (
  `id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  `tenant_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `station_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `product_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `type` VARCHAR(255) NOT NULL,
  `quantity` VARCHAR(255) NOT NULL,
  `rate` VARCHAR(255) NOT NULL DEFAULT '0',
  `amount` VARCHAR(255) NOT NULL DEFAULT '0',
  `payment_mode` VARCHAR(255),
  `customer_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin,
  `vehicle_number` VARCHAR(255),
  `supplier_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin,
  `reference` VARCHAR(255),
  `occurred_at` VARCHAR(40) NOT NULL,
  `note` TEXT,
  `created_by` VARCHAR(255),
  `is_demo` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` VARCHAR(40) NOT NULL,
    CONSTRAINT `fk_lube_movements_tenant_id` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT,
    CONSTRAINT `fk_lube_movements_station_id` FOREIGN KEY (`station_id`) REFERENCES `stations` (`id`) ON DELETE RESTRICT,
    CONSTRAINT `fk_lube_movements_product_id` FOREIGN KEY (`product_id`) REFERENCES `lube_products` (`id`) ON DELETE RESTRICT,
    CONSTRAINT `fk_lube_movements_customer_id` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`) ON DELETE SET NULL,
    CONSTRAINT `fk_lube_movements_supplier_id` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @exists := (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'lube_movements' AND index_name = 'idx_lube_movements_station');
SET @ddl := IF(@exists = 0, 'ALTER TABLE `lube_movements` ADD INDEX `idx_lube_movements_station` (station_id, occurred_at)', 'DO 0');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @exists := (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'lube_movements' AND index_name = 'idx_lube_movements_product');
SET @ddl := IF(@exists = 0, 'ALTER TABLE `lube_movements` ADD INDEX `idx_lube_movements_product` (product_id, occurred_at)', 'DO 0');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS `attendance_records` (
  `id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  `tenant_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `station_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `user_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `attendance_date` DATE NOT NULL,
  `status` VARCHAR(255) NOT NULL DEFAULT 'PRESENT',
  `in_time` VARCHAR(255),
  `out_time` VARCHAR(255),
  `note` TEXT,
  `marked_by` VARCHAR(255),
  `created_at` VARCHAR(40) NOT NULL,
  `updated_at` VARCHAR(40) NOT NULL,
  UNIQUE KEY `uq_attendance_records_user_id__attendance_date` (user_id, attendance_date),
    CONSTRAINT `fk_attendance_records_tenant_id` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT,
    CONSTRAINT `fk_attendance_records_station_id` FOREIGN KEY (`station_id`) REFERENCES `stations` (`id`) ON DELETE RESTRICT,
    CONSTRAINT `fk_attendance_records_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @exists := (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'attendance_records' AND index_name = 'idx_attendance_station_date');
SET @ddl := IF(@exists = 0, 'ALTER TABLE `attendance_records` ADD INDEX `idx_attendance_station_date` (station_id, attendance_date)', 'DO 0');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS `customer_followups` (
  `id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  `tenant_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `customer_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `station_id` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin,
  `kind` VARCHAR(255) NOT NULL DEFAULT 'NOTE',
  `note` TEXT NOT NULL,
  `promised_amount` VARCHAR(255),
  `next_on` DATE,
  `created_by` VARCHAR(255),
  `created_at` VARCHAR(40) NOT NULL,
    CONSTRAINT `fk_customer_followups_tenant_id` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT,
    CONSTRAINT `fk_customer_followups_customer_id` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_customer_followups_station_id` FOREIGN KEY (`station_id`) REFERENCES `stations` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @exists := (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'customer_followups' AND index_name = 'idx_followups_customer');
SET @ddl := IF(@exists = 0, 'ALTER TABLE `customer_followups` ADD INDEX `idx_followups_customer` (customer_id, created_at)', 'DO 0');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @exists := (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'customer_followups' AND index_name = 'idx_followups_due');
SET @ddl := IF(@exists = 0, 'ALTER TABLE `customer_followups` ADD INDEX `idx_followups_due` (tenant_id, next_on)', 'DO 0');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET FOREIGN_KEY_CHECKS = 1;
