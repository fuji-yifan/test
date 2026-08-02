-- CreateTable
CREATE TABLE `process_definitions` (
    `id` VARCHAR(36) NOT NULL,
    `workspace_id` VARCHAR(36) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `description` TEXT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `status` VARCHAR(20) NOT NULL DEFAULT 'draft',
    `nodes` JSON NOT NULL,
    `edges` JSON NOT NULL,
    `settings` JSON NOT NULL,
    `created_by` VARCHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `process_definitions_workspace_id_status_idx`(`workspace_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `process_instances` (
    `id` VARCHAR(36) NOT NULL,
    `definition_id` VARCHAR(36) NOT NULL,
    `definition_version` INTEGER NOT NULL,
    `form_id` VARCHAR(36) NULL,
    `submission_id` VARCHAR(36) NULL,
    `initiator_id` VARCHAR(36) NOT NULL,
    `current_state` VARCHAR(20) NOT NULL DEFAULT 'draft',
    `current_node_ids` JSON NOT NULL,
    `context` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completed_at` DATETIME(3) NULL,

    INDEX `process_instances_initiator_id_current_state_idx`(`initiator_id`, `current_state`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `task_instances` (
    `id` VARCHAR(36) NOT NULL,
    `instance_id` VARCHAR(36) NOT NULL,
    `node_id` VARCHAR(36) NOT NULL,
    `assignee_id` VARCHAR(36) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'pending',
    `comment` TEXT NULL,
    `transferred_from` VARCHAR(36) NULL,
    `added_by_sign` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `processed_at` DATETIME(3) NULL,

    INDEX `task_instances_assignee_id_status_idx`(`assignee_id`, `status`),
    INDEX `task_instances_instance_id_idx`(`instance_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `process_instances` ADD CONSTRAINT `process_instances_definition_id_fkey` FOREIGN KEY (`definition_id`) REFERENCES `process_definitions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `task_instances` ADD CONSTRAINT `task_instances_instance_id_fkey` FOREIGN KEY (`instance_id`) REFERENCES `process_instances`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
