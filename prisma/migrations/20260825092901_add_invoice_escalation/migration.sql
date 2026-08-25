-- AlterTable
ALTER TABLE `RecoveryEvent` ADD COLUMN `dueDate` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `RecoveryPolicy` ADD COLUMN `escalationTier` INTEGER NULL;
