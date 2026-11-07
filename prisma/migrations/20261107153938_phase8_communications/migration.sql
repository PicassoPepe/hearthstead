-- CreateTable
CREATE TABLE "OwnerUser" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "OwnerUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "subject" TEXT,
    "tenantId" TEXT,
    "ownerId" TEXT,
    "vendorId" TEXT,
    "phone" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "assigneeId" TEXT,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMessagePreview" TEXT,
    "unreadCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "authorUserId" TEXT,
    "authorName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SENT',
    "externalId" TEXT,
    "segments" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "readAt" TIMESTAMP(3),
    "announcementId" TEXT,
    "aiDrafted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "audience" JSONB NOT NULL,
    "channels" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "scheduledFor" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "recipientCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnnouncementDelivery" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "announcementId" TEXT NOT NULL,
    "recipientKey" TEXT NOT NULL,
    "tenantId" TEXT,
    "ownerId" TEXT,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnnouncementDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmsOptOut" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SmsOptOut_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OwnerUser_userId_idx" ON "OwnerUser"("userId");

-- CreateIndex
CREATE INDEX "OwnerUser_organizationId_idx" ON "OwnerUser"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "OwnerUser_ownerId_userId_key" ON "OwnerUser"("ownerId", "userId");

-- CreateIndex
CREATE INDEX "Conversation_organizationId_lastMessageAt_idx" ON "Conversation"("organizationId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "Conversation_organizationId_tenantId_idx" ON "Conversation"("organizationId", "tenantId");

-- CreateIndex
CREATE INDEX "Conversation_organizationId_ownerId_idx" ON "Conversation"("organizationId", "ownerId");

-- CreateIndex
CREATE INDEX "Conversation_organizationId_phone_idx" ON "Conversation"("organizationId", "phone");

-- CreateIndex
CREATE INDEX "Message_organizationId_conversationId_createdAt_idx" ON "Message"("organizationId", "conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "Message_organizationId_channel_createdAt_idx" ON "Message"("organizationId", "channel", "createdAt");

-- CreateIndex
CREATE INDEX "Message_externalId_idx" ON "Message"("externalId");

-- CreateIndex
CREATE INDEX "Announcement_organizationId_status_scheduledFor_idx" ON "Announcement"("organizationId", "status", "scheduledFor");

-- CreateIndex
CREATE INDEX "AnnouncementDelivery_organizationId_tenantId_idx" ON "AnnouncementDelivery"("organizationId", "tenantId");

-- CreateIndex
CREATE INDEX "AnnouncementDelivery_organizationId_ownerId_idx" ON "AnnouncementDelivery"("organizationId", "ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "AnnouncementDelivery_announcementId_recipientKey_channel_key" ON "AnnouncementDelivery"("announcementId", "recipientKey", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "SmsOptOut_organizationId_phone_key" ON "SmsOptOut"("organizationId", "phone");

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnnouncementDelivery" ADD CONSTRAINT "AnnouncementDelivery_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "Announcement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
