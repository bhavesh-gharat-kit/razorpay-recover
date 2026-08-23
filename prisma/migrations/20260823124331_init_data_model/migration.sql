-- CreateTable
CREATE TABLE `Merchant` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `razorpayAccountId` VARCHAR(191) NOT NULL,
    `contactEmail` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Customer` (
    `id` VARCHAR(191) NOT NULL,
    `merchantId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Customer_merchantId_idx`(`merchantId`),
    UNIQUE INDEX `Customer_merchantId_email_key`(`merchantId`, `email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RecoveryEvent` (
    `id` VARCHAR(191) NOT NULL,
    `merchantId` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `scenario` ENUM('CHECKOUT_DROPOFF', 'SUBSCRIPTION_FAILURE', 'INVOICE_OVERDUE') NOT NULL,
    `sourceType` VARCHAR(191) NOT NULL,
    `razorpayRefId` VARCHAR(191) NULL,
    `rawPayload` JSON NOT NULL,
    `amountPaise` INTEGER NOT NULL,
    `currency` VARCHAR(191) NOT NULL DEFAULT 'INR',
    `occurredAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `RecoveryEvent_razorpayRefId_key`(`razorpayRefId`),
    INDEX `RecoveryEvent_merchantId_idx`(`merchantId`),
    INDEX `RecoveryEvent_customerId_idx`(`customerId`),
    INDEX `RecoveryEvent_scenario_idx`(`scenario`),
    INDEX `RecoveryEvent_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ClassifiedCase` (
    `id` VARCHAR(191) NOT NULL,
    `recoveryEventId` VARCHAR(191) NOT NULL,
    `causeCode` VARCHAR(191) NOT NULL,
    `confidence` DOUBLE NOT NULL,
    `source` ENUM('RULE', 'EMBEDDING', 'HUMAN') NOT NULL,
    `modelVersion` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ClassifiedCase_recoveryEventId_key`(`recoveryEventId`),
    INDEX `ClassifiedCase_causeCode_idx`(`causeCode`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Case` (
    `id` VARCHAR(191) NOT NULL,
    `recoveryEventId` VARCHAR(191) NOT NULL,
    `classifiedCaseId` VARCHAR(191) NULL,
    `merchantId` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `state` ENUM('DETECTED', 'DIAGNOSED', 'ACTION_SCHEDULED', 'ACTION_SENT', 'RECOVERED', 'ESCALATED', 'ABANDONED', 'CLOSED') NOT NULL DEFAULT 'DETECTED',
    `attemptCount` INTEGER NOT NULL DEFAULT 0,
    `maxAttempts` INTEGER NOT NULL,
    `recoveredAmountPaise` INTEGER NULL,
    `recoveryLinkId` VARCHAR(191) NULL,
    `recoveryLinkUrl` VARCHAR(191) NULL,
    `promisedPaymentDate` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Case_recoveryEventId_key`(`recoveryEventId`),
    UNIQUE INDEX `Case_classifiedCaseId_key`(`classifiedCaseId`),
    INDEX `Case_merchantId_idx`(`merchantId`),
    INDEX `Case_customerId_idx`(`customerId`),
    INDEX `Case_state_idx`(`state`),
    INDEX `Case_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CaseTransition` (
    `id` VARCHAR(191) NOT NULL,
    `caseId` VARCHAR(191) NOT NULL,
    `fromState` VARCHAR(191) NULL,
    `toState` VARCHAR(191) NOT NULL,
    `actor` ENUM('SYSTEM', 'HUMAN') NOT NULL,
    `actorUserId` VARCHAR(191) NULL,
    `reasonCode` VARCHAR(191) NOT NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CaseTransition_caseId_idx`(`caseId`),
    INDEX `CaseTransition_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RecoveryPolicy` (
    `id` VARCHAR(191) NOT NULL,
    `scenario` ENUM('CHECKOUT_DROPOFF', 'SUBSCRIPTION_FAILURE', 'INVOICE_OVERDUE') NOT NULL,
    `causeCode` VARCHAR(191) NOT NULL,
    `allowedActions` JSON NOT NULL,
    `cooldownMinutes` INTEGER NOT NULL,
    `maxAttempts` INTEGER NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `sendWindowStartHour` INTEGER NOT NULL DEFAULT 9,
    `sendWindowEndHour` INTEGER NOT NULL DEFAULT 21,
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `RecoveryPolicy_scenario_causeCode_idx`(`scenario`, `causeCode`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DraftMessage` (
    `id` VARCHAR(191) NOT NULL,
    `caseId` VARCHAR(191) NOT NULL,
    `channel` ENUM('EMAIL', 'SMS', 'WHATSAPP') NOT NULL,
    `language` ENUM('EN', 'HINGLISH') NOT NULL,
    `subject` VARCHAR(191) NULL,
    `body` TEXT NOT NULL,
    `generatedBy` ENUM('TEMPLATE', 'LLM') NOT NULL,
    `promptVersion` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `DraftMessage_caseId_idx`(`caseId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DeliveryAttempt` (
    `id` VARCHAR(191) NOT NULL,
    `draftMessageId` VARCHAR(191) NOT NULL,
    `channel` ENUM('EMAIL', 'SMS', 'WHATSAPP') NOT NULL,
    `providerRef` VARCHAR(191) NULL,
    `status` ENUM('SENT', 'FAILED', 'BOUNCED', 'DELIVERED') NOT NULL,
    `errorDetail` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `DeliveryAttempt_draftMessageId_idx`(`draftMessageId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ScheduledJob` (
    `id` VARCHAR(191) NOT NULL,
    `caseId` VARCHAR(191) NULL,
    `jobType` VARCHAR(191) NOT NULL,
    `payload` JSON NOT NULL,
    `runAt` DATETIME(3) NOT NULL,
    `status` ENUM('PENDING', 'PROCESSING', 'DONE', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `lastError` TEXT NULL,
    `lockedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ScheduledJob_status_runAt_idx`(`status`, `runAt`),
    INDEX `ScheduledJob_caseId_idx`(`caseId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuditLog` (
    `id` VARCHAR(191) NOT NULL,
    `entityType` VARCHAR(191) NOT NULL,
    `entityId` VARCHAR(191) NOT NULL,
    `actor` ENUM('SYSTEM', 'HUMAN') NOT NULL,
    `actorUserId` VARCHAR(191) NULL,
    `action` VARCHAR(191) NOT NULL,
    `reasonCode` VARCHAR(191) NULL,
    `beforeState` JSON NULL,
    `afterState` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AuditLog_entityType_entityId_idx`(`entityType`, `entityId`),
    INDEX `AuditLog_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `User` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(191) NOT NULL,
    `role` ENUM('ADMIN', 'REVIEWER', 'VIEWER') NOT NULL DEFAULT 'VIEWER',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `User_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Customer` ADD CONSTRAINT `Customer_merchantId_fkey` FOREIGN KEY (`merchantId`) REFERENCES `Merchant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RecoveryEvent` ADD CONSTRAINT `RecoveryEvent_merchantId_fkey` FOREIGN KEY (`merchantId`) REFERENCES `Merchant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RecoveryEvent` ADD CONSTRAINT `RecoveryEvent_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ClassifiedCase` ADD CONSTRAINT `ClassifiedCase_recoveryEventId_fkey` FOREIGN KEY (`recoveryEventId`) REFERENCES `RecoveryEvent`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Case` ADD CONSTRAINT `Case_recoveryEventId_fkey` FOREIGN KEY (`recoveryEventId`) REFERENCES `RecoveryEvent`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Case` ADD CONSTRAINT `Case_classifiedCaseId_fkey` FOREIGN KEY (`classifiedCaseId`) REFERENCES `ClassifiedCase`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Case` ADD CONSTRAINT `Case_merchantId_fkey` FOREIGN KEY (`merchantId`) REFERENCES `Merchant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Case` ADD CONSTRAINT `Case_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CaseTransition` ADD CONSTRAINT `CaseTransition_caseId_fkey` FOREIGN KEY (`caseId`) REFERENCES `Case`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CaseTransition` ADD CONSTRAINT `CaseTransition_actorUserId_fkey` FOREIGN KEY (`actorUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DraftMessage` ADD CONSTRAINT `DraftMessage_caseId_fkey` FOREIGN KEY (`caseId`) REFERENCES `Case`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DeliveryAttempt` ADD CONSTRAINT `DeliveryAttempt_draftMessageId_fkey` FOREIGN KEY (`draftMessageId`) REFERENCES `DraftMessage`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ScheduledJob` ADD CONSTRAINT `ScheduledJob_caseId_fkey` FOREIGN KEY (`caseId`) REFERENCES `Case`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuditLog` ADD CONSTRAINT `AuditLog_actorUserId_fkey` FOREIGN KEY (`actorUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
