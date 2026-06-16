-- CreateTable
CREATE TABLE "Series" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bangumiId" INTEGER,
    "tmdbId" INTEGER,
    "tvdbId" INTEGER,
    "anidbId" INTEGER,
    "titleJp" TEXT NOT NULL,
    "titleCn" TEXT,
    "titleEn" TEXT,
    "year" INTEGER,
    "seasonCount" INTEGER NOT NULL DEFAULT 1,
    "seasonOffset" TEXT,
    "courMode" TEXT NOT NULL DEFAULT 'absolute',
    "totalEpisodes" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'ONGOING',
    "airWeekday" INTEGER,
    "posterUrl" TEXT,
    "metadataRaw" TEXT,
    "lockedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Episode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "seriesId" TEXT NOT NULL,
    "bangumiEpId" INTEGER,
    "type" INTEGER NOT NULL DEFAULT 0,
    "sort" INTEGER,
    "ep" INTEGER,
    "absoluteNumber" INTEGER,
    "epInSeason" INTEGER,
    "seasonIndex" INTEGER NOT NULL DEFAULT 1,
    "titleJp" TEXT,
    "titleCn" TEXT,
    "airdate" TEXT,
    "duration" INTEGER,
    CONSTRAINT "Episode_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "Series" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "seriesId" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "filterRule" TEXT NOT NULL,
    "matchHints" TEXT,
    "category" TEXT NOT NULL DEFAULT '动漫',
    "savePath" TEXT,
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "autoRename" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenPubDate" DATETIME,
    "lastRunAt" DATETIME,
    "lastMatchCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Subscription_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "Series" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DownloadTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "subscriptionId" TEXT,
    "seriesId" TEXT,
    "infoHash" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceItemId" TEXT,
    "magnet" TEXT,
    "torrentUrl" TEXT,
    "rawTitle" TEXT NOT NULL,
    "parsedTitle" TEXT,
    "fansub" TEXT,
    "subtitleLang" TEXT,
    "sizeBytes" BIGINT NOT NULL,
    "pubDate" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "qbStateRaw" TEXT,
    "progress" REAL NOT NULL DEFAULT 0,
    "hash" TEXT,
    "savePath" TEXT,
    "stalledSince" DATETIME,
    "completedAt" DATETIME,
    "addedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DownloadTask_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MediaFile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "downloadTaskId" TEXT NOT NULL,
    "seriesId" TEXT,
    "episodeId" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'video',
    "sourcePath" TEXT NOT NULL,
    "libraryPath" TEXT,
    "fileName" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "scrapeState" TEXT NOT NULL DEFAULT 'PENDING',
    "scrapeResult" TEXT,
    "scrapeError" TEXT,
    "scrapedAt" DATETIME,
    "reviewedBy" TEXT,
    "reviewedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MediaFile_downloadTaskId_fkey" FOREIGN KEY ("downloadTaskId") REFERENCES "DownloadTask" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MediaFile_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "Series" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MediaFile_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MagnetSeen" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "infoHash" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceItemId" TEXT,
    "firstSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "downloadTaskId" TEXT,
    "invalidated" BOOLEAN NOT NULL DEFAULT false
);

-- CreateTable
CREATE TABLE "EpisodeDedup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "seriesId" TEXT NOT NULL,
    "seasonIndex" INTEGER NOT NULL,
    "epInSeason" INTEGER NOT NULL,
    "mediaFileId" TEXT,
    "infoHash" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "EpisodeOverride" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "seriesId" TEXT NOT NULL,
    "absoluteNumber" INTEGER NOT NULL,
    "season" INTEGER NOT NULL,
    "episode" INTEGER NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EpisodeOverride_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "Series" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ScrapeCache" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fingerprint" TEXT NOT NULL,
    "rawFilename" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptTokens" INTEGER,
    "completionTokens" INTEGER,
    "costUsd" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "FewShotSample" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "filename" TEXT NOT NULL,
    "output" TEXT NOT NULL,
    "releaseGroup" TEXT,
    "titleKey" TEXT,
    "seriesId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "reviewStatus" TEXT NOT NULL DEFAULT 'approved',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" DATETIME
);

-- CreateTable
CREATE TABLE "LlmCall" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mediaFileId" TEXT,
    "model" TEXT NOT NULL,
    "promptTokens" INTEGER NOT NULL,
    "completionTokens" INTEGER NOT NULL,
    "costUsd" REAL NOT NULL,
    "finishReason" TEXT,
    "success" BOOLEAN NOT NULL,
    "error" TEXT,
    "cached" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Settings" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "category" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "encrypted" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "JobRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "queueTaskId" TEXT,
    "checkpoint" TEXT,
    "payload" TEXT,
    "result" TEXT,
    "error" TEXT,
    "runs" INTEGER NOT NULL DEFAULT 0,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Series_bangumiId_key" ON "Series"("bangumiId");

-- CreateIndex
CREATE INDEX "Series_status_airWeekday_idx" ON "Series"("status", "airWeekday");

-- CreateIndex
CREATE INDEX "Series_tmdbId_idx" ON "Series"("tmdbId");

-- CreateIndex
CREATE INDEX "Series_titleCn_idx" ON "Series"("titleCn");

-- CreateIndex
CREATE UNIQUE INDEX "Episode_bangumiEpId_key" ON "Episode"("bangumiEpId");

-- CreateIndex
CREATE INDEX "Episode_seriesId_absoluteNumber_idx" ON "Episode"("seriesId", "absoluteNumber");

-- CreateIndex
CREATE INDEX "Episode_seriesId_seasonIndex_epInSeason_idx" ON "Episode"("seriesId", "seasonIndex", "epInSeason");

-- CreateIndex
CREATE INDEX "Subscription_enabled_idx" ON "Subscription"("enabled");

-- CreateIndex
CREATE INDEX "Subscription_seriesId_idx" ON "Subscription"("seriesId");

-- CreateIndex
CREATE UNIQUE INDEX "DownloadTask_infoHash_key" ON "DownloadTask"("infoHash");

-- CreateIndex
CREATE INDEX "DownloadTask_subscriptionId_idx" ON "DownloadTask"("subscriptionId");

-- CreateIndex
CREATE INDEX "DownloadTask_status_idx" ON "DownloadTask"("status");

-- CreateIndex
CREATE INDEX "DownloadTask_source_sourceItemId_idx" ON "DownloadTask"("source", "sourceItemId");

-- CreateIndex
CREATE INDEX "MediaFile_scrapeState_idx" ON "MediaFile"("scrapeState");

-- CreateIndex
CREATE INDEX "MediaFile_seriesId_idx" ON "MediaFile"("seriesId");

-- CreateIndex
CREATE INDEX "MediaFile_downloadTaskId_idx" ON "MediaFile"("downloadTaskId");

-- CreateIndex
CREATE UNIQUE INDEX "MediaFile_seriesId_libraryPath_key" ON "MediaFile"("seriesId", "libraryPath");

-- CreateIndex
CREATE UNIQUE INDEX "MagnetSeen_infoHash_key" ON "MagnetSeen"("infoHash");

-- CreateIndex
CREATE INDEX "MagnetSeen_source_sourceItemId_idx" ON "MagnetSeen"("source", "sourceItemId");

-- CreateIndex
CREATE INDEX "EpisodeDedup_seriesId_idx" ON "EpisodeDedup"("seriesId");

-- CreateIndex
CREATE UNIQUE INDEX "EpisodeDedup_seriesId_seasonIndex_epInSeason_key" ON "EpisodeDedup"("seriesId", "seasonIndex", "epInSeason");

-- CreateIndex
CREATE INDEX "EpisodeOverride_seriesId_idx" ON "EpisodeOverride"("seriesId");

-- CreateIndex
CREATE UNIQUE INDEX "EpisodeOverride_seriesId_absoluteNumber_key" ON "EpisodeOverride"("seriesId", "absoluteNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ScrapeCache_fingerprint_key" ON "ScrapeCache"("fingerprint");

-- CreateIndex
CREATE INDEX "ScrapeCache_createdAt_idx" ON "ScrapeCache"("createdAt");

-- CreateIndex
CREATE INDEX "FewShotSample_releaseGroup_lastUsedAt_idx" ON "FewShotSample"("releaseGroup", "lastUsedAt");

-- CreateIndex
CREATE INDEX "FewShotSample_titleKey_idx" ON "FewShotSample"("titleKey");

-- CreateIndex
CREATE INDEX "LlmCall_createdAt_idx" ON "LlmCall"("createdAt");

-- CreateIndex
CREATE INDEX "Settings_category_idx" ON "Settings"("category");

-- CreateIndex
CREATE INDEX "JobRun_kind_status_idx" ON "JobRun"("kind", "status");

-- CreateIndex
CREATE INDEX "JobRun_status_idx" ON "JobRun"("status");
