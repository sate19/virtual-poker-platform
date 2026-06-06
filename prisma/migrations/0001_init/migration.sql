CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN');
CREATE TYPE "RoomStatus" AS ENUM ('WAITING', 'PLAYING', 'FINISHED', 'CLOSED');
CREATE TYPE "SeatStatus" AS ENUM ('OCCUPIED', 'STANDING');
CREATE TYPE "HandPhase" AS ENUM ('PREFLOP', 'FLOP', 'TURN', 'RIVER', 'SHOWDOWN', 'FINISHED');
CREATE TYPE "TournamentStatus" AS ENUM ('DRAFT', 'REGISTERING', 'PLAYING', 'FINISHED', 'CANCELLED');

CREATE TABLE "User" (
  "id" TEXT NOT NULL,
  "username" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "role" "UserRole" NOT NULL DEFAULT 'USER',
  "virtualChips" INTEGER NOT NULL DEFAULT 10000,
  "isBanned" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "lastLoginAt" TIMESTAMP(3),
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UserStats" (
  "userId" TEXT NOT NULL,
  "totalHands" INTEGER NOT NULL DEFAULT 0,
  "handsWon" INTEGER NOT NULL DEFAULT 0,
  "voluntarilyPutInPot" INTEGER NOT NULL DEFAULT 0,
  "showdownCount" INTEGER NOT NULL DEFAULT 0,
  "showdownWins" INTEGER NOT NULL DEFAULT 0,
  "netVirtualChips" INTEGER NOT NULL DEFAULT 0,
  "biggestPotWon" INTEGER NOT NULL DEFAULT 0,
  "tournamentsPlayed" INTEGER NOT NULL DEFAULT 0,
  "tournamentsWon" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserStats_pkey" PRIMARY KEY ("userId")
);

CREATE TABLE "Room" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" "RoomStatus" NOT NULL DEFAULT 'WAITING',
  "maxPlayers" INTEGER NOT NULL DEFAULT 9,
  "smallBlind" INTEGER NOT NULL,
  "bigBlind" INTEGER NOT NULL,
  "minBuyIn" INTEGER NOT NULL,
  "maxBuyIn" INTEGER NOT NULL,
  "allowSpectators" BOOLEAN NOT NULL DEFAULT true,
  "createdById" TEXT NOT NULL,
  "gameSnapshot" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "closedAt" TIMESTAMP(3),
  CONSTRAINT "Room_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RoomSeat" (
  "id" TEXT NOT NULL,
  "roomId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "seatIndex" INTEGER NOT NULL,
  "tableChips" INTEGER NOT NULL,
  "ready" BOOLEAN NOT NULL DEFAULT false,
  "status" "SeatStatus" NOT NULL DEFAULT 'OCCUPIED',
  "satAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leftAt" TIMESTAMP(3),
  CONSTRAINT "RoomSeat_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Hand" (
  "id" TEXT NOT NULL,
  "roomId" TEXT NOT NULL,
  "handNumber" INTEGER NOT NULL,
  "buttonSeatIndex" INTEGER NOT NULL,
  "smallBlind" INTEGER NOT NULL,
  "bigBlind" INTEGER NOT NULL,
  "board" JSONB NOT NULL,
  "potTotal" INTEGER NOT NULL,
  "result" JSONB NOT NULL,
  "stateSnapshot" JSONB NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedAt" TIMESTAMP(3),
  CONSTRAINT "Hand_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "HandPlayer" (
  "id" TEXT NOT NULL,
  "handId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "seatIndex" INTEGER NOT NULL,
  "startingStack" INTEGER NOT NULL,
  "endingStack" INTEGER NOT NULL,
  "totalCommitted" INTEGER NOT NULL,
  "holeCards" JSONB NOT NULL,
  "folded" BOOLEAN NOT NULL,
  "wonAmount" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "HandPlayer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GameAction" (
  "id" TEXT NOT NULL,
  "roomId" TEXT NOT NULL,
  "handId" TEXT,
  "userId" TEXT,
  "phase" "HandPhase",
  "action" TEXT NOT NULL,
  "amount" INTEGER,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GameAction_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ChatMessage" (
  "id" TEXT NOT NULL,
  "roomId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AdminAuditLog" (
  "id" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VirtualChipLedger" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "delta" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "roomId" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VirtualChipLedger_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Tournament" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" "TournamentStatus" NOT NULL DEFAULT 'DRAFT',
  "maxPlayers" INTEGER NOT NULL DEFAULT 9,
  "startingChips" INTEGER NOT NULL DEFAULT 3000,
  "blindSchedule" JSONB NOT NULL,
  "currentLevel" INTEGER NOT NULL DEFAULT 0,
  "handsPerLevel" INTEGER NOT NULL DEFAULT 10,
  "winnerUserId" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "startedAt" TIMESTAMP(3),
  "endedAt" TIMESTAMP(3),
  CONSTRAINT "Tournament_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TournamentPlayer" (
  "id" TEXT NOT NULL,
  "tournamentId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "seatIndex" INTEGER,
  "chips" INTEGER NOT NULL,
  "finishingPlace" INTEGER,
  "eliminatedAt" TIMESTAMP(3),
  CONSTRAINT "TournamentPlayer_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
CREATE UNIQUE INDEX "RoomSeat_roomId_seatIndex_key" ON "RoomSeat"("roomId", "seatIndex");
CREATE UNIQUE INDEX "RoomSeat_roomId_userId_key" ON "RoomSeat"("roomId", "userId");
CREATE UNIQUE INDEX "HandPlayer_handId_userId_key" ON "HandPlayer"("handId", "userId");
CREATE UNIQUE INDEX "TournamentPlayer_tournamentId_userId_key" ON "TournamentPlayer"("tournamentId", "userId");

ALTER TABLE "UserStats" ADD CONSTRAINT "UserStats_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Room" ADD CONSTRAINT "Room_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RoomSeat" ADD CONSTRAINT "RoomSeat_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RoomSeat" ADD CONSTRAINT "RoomSeat_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Hand" ADD CONSTRAINT "Hand_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HandPlayer" ADD CONSTRAINT "HandPlayer_handId_fkey" FOREIGN KEY ("handId") REFERENCES "Hand"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HandPlayer" ADD CONSTRAINT "HandPlayer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GameAction" ADD CONSTRAINT "GameAction_handId_fkey" FOREIGN KEY ("handId") REFERENCES "Hand"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GameAction" ADD CONSTRAINT "GameAction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AdminAuditLog" ADD CONSTRAINT "AdminAuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VirtualChipLedger" ADD CONSTRAINT "VirtualChipLedger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TournamentPlayer" ADD CONSTRAINT "TournamentPlayer_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TournamentPlayer" ADD CONSTRAINT "TournamentPlayer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
