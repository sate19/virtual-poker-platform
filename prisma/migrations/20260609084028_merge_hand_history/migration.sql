/*
  Warnings:

  - You are about to drop the `GameAction` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Hand` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `HandPlayer` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "GameAction" DROP CONSTRAINT "GameAction_handId_fkey";

-- DropForeignKey
ALTER TABLE "GameAction" DROP CONSTRAINT "GameAction_userId_fkey";

-- DropForeignKey
ALTER TABLE "Hand" DROP CONSTRAINT "Hand_roomId_fkey";

-- DropForeignKey
ALTER TABLE "HandPlayer" DROP CONSTRAINT "HandPlayer_handId_fkey";

-- DropForeignKey
ALTER TABLE "HandPlayer" DROP CONSTRAINT "HandPlayer_userId_fkey";

-- DropTable
DROP TABLE "GameAction";

-- DropTable
DROP TABLE "Hand";

-- DropTable
DROP TABLE "HandPlayer";

-- CreateTable
CREATE TABLE "UserHandHistory" (
    "id" TEXT NOT NULL,
    "handId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "roomName" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "handNumber" INTEGER NOT NULL,
    "playerCount" INTEGER NOT NULL,
    "buttonSeatIndex" INTEGER NOT NULL,
    "deckType" TEXT NOT NULL DEFAULT 'standard',
    "smallBlind" INTEGER NOT NULL,
    "bigBlind" INTEGER NOT NULL,
    "ante" INTEGER NOT NULL,
    "seatIndex" INTEGER NOT NULL,
    "holeCards" JSONB NOT NULL,
    "communityCards" JSONB NOT NULL,
    "startingStack" INTEGER NOT NULL,
    "endingStack" INTEGER NOT NULL,
    "netResult" INTEGER NOT NULL,
    "totalCommitted" INTEGER NOT NULL,
    "folded" BOOLEAN NOT NULL,
    "wonAmount" INTEGER NOT NULL,
    "bestHand" JSONB,
    "potTotal" INTEGER NOT NULL,
    "result" TEXT NOT NULL,
    "actions" JSONB NOT NULL,
    "opponents" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserHandHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserHandHistory_userId_createdAt_idx" ON "UserHandHistory"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "UserHandHistory_handId_idx" ON "UserHandHistory"("handId");

-- AddForeignKey
ALTER TABLE "UserHandHistory" ADD CONSTRAINT "UserHandHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
