const repository = "golbin/hop";
const releasesUrl = `https://github.com/${repository}/releases`;
const latestReleaseApiUrl = `https://api.github.com/repos/${repository}/releases/latest`;

const downloadLinks = Array.from(
  document.querySelectorAll("[data-download-asset]"),
);
const downloadStatus = document.querySelector("#download-status");

function pointToReleases(message) {
  for (const link of downloadLinks) {
    link.href = releasesUrl;
    link.dataset.available = "false";
  }

  if (downloadStatus) {
    downloadStatus.textContent = message;
  }
}

async function hydrateDownloadLinks() {
  if (downloadLinks.length === 0) {
    return;
  }

  const response = await fetch(latestReleaseApiUrl, {
    headers: {
      Accept: "application/vnd.github+json",
    },
  });

  if (response.status === 404) {
    pointToReleases(
      "아직 공개된 최신 릴리즈가 없습니다. 릴리즈 목록에서 준비 상태를 확인할 수 있습니다.",
    );
    return;
  }

  if (!response.ok) {
    return;
  }

  const release = await response.json();
  const assets = new Map(
    release.assets.map((asset) => [asset.name, asset.browser_download_url]),
  );
  let linkedCount = 0;

  for (const link of downloadLinks) {
    const assetName = link.dataset.downloadAsset;
    const downloadUrl = assets.get(assetName);

    if (downloadUrl) {
      link.href = downloadUrl;
      link.dataset.available = "true";
      linkedCount += 1;
    } else {
      link.href = releasesUrl;
      link.dataset.available = "false";
    }
  }

  if (!downloadStatus) {
    return;
  }

  if (linkedCount === downloadLinks.length) {
    downloadStatus.textContent = `${release.name || release.tag_name} 파일로 연결됩니다.`;
  } else {
    downloadStatus.textContent =
      "일부 플랫폼 파일이 아직 준비되지 않았습니다. 릴리즈 목록에서 전체 파일을 확인할 수 있습니다.";
  }
}

hydrateDownloadLinks().catch(() => {
  // Keep the static latest/download URLs when the API cannot be reached.
});
