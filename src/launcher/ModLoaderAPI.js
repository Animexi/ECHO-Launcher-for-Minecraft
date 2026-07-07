const axios = require('axios');

class ModLoaderAPI {
  constructor() {
    this.forgeVersionsCache = null;
    this.fabricVersionsCache = null;
    this.neoforgeVersionsCache = null;
    this.quiltVersionsCache = null;
  }

  async getForgeVersions() {
    if (this.forgeVersionsCache) {
      return this.forgeVersionsCache;
    }

    try {
      const response = await axios.get('https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml');
      const xmlText = response.data;

      const versionMatches = xmlText.match(/<version>([^<]+)<\/version>/g);

      if (!versionMatches) {
        console.error('No Forge versions found');
        return this.getFallbackForgeVersions();
      }

      const versions = [];
      const versionMap = new Map();

      versionMatches.forEach(match => {
        const version = match.replace(/<\/?version>/g, '');

        const parts = version.split('-');
        if (parts.length >= 2) {
          const mcVersion = parts[0];
          const forgeVersion = parts[1];

          if (!versionMap.has(mcVersion)) {
            versionMap.set(mcVersion, []);
          }
          versionMap.get(mcVersion).push({
            id: `${mcVersion}-forge-${forgeVersion}`,
            mcVersion: mcVersion,
            forgeVersion: forgeVersion,
            type: 'release',
            loader: 'forge'
          });
        }
      });

      const mcVersionsOrder = ['1.21.1', '1.21', '1.20.6', '1.20.5', '1.20.4', '1.20.3', '1.20.2', '1.20.1', '1.20', '1.19.4', '1.19.3', '1.19.2', '1.19.1', '1.19', '1.18.2', '1.18.1', '1.18', '1.17.1', '1.17', '1.16.5', '1.16.4', '1.16.3', '1.16.2', '1.16.1', '1.15.2', '1.14.4', '1.13.2', '1.12.2', '1.11.2', '1.10.2', '1.9.4', '1.8.9', '1.7.10'];

      for (const mcVer of mcVersionsOrder) {
        if (versionMap.has(mcVer)) {
          const forgeVers = versionMap.get(mcVer);
          forgeVers.sort((a, b) => this.compareVersions(b.forgeVersion, a.forgeVersion));
          for (const fv of forgeVers.slice(0, 3)) {
            versions.push(fv);
          }
        }
      }

      for (const [mcVer, forgeVers] of versionMap.entries()) {
        if (!mcVersionsOrder.includes(mcVer)) {
          forgeVers.sort((a, b) => this.compareVersions(b.forgeVersion, a.forgeVersion));
          for (const fv of forgeVers.slice(0, 2)) {
            versions.push(fv);
          }
        }
      }

      this.forgeVersionsCache = versions;
      return this.forgeVersionsCache;
    } catch (error) {
      console.error('Error fetching Forge versions:', error);
      return this.getFallbackForgeVersions();
    }
  }

  compareVersions(v1, v2) {
    const a = v1.split('.').map(Number);
    const b = v2.split('.').map(Number);
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const n1 = a[i] || 0;
      const n2 = b[i] || 0;
      if (n1 !== n2) return n1 - n2;
    }
    return 0;
  }

  getFallbackForgeVersions() {
    return [
      { id: '1.21.1-forge-52.0.16', mcVersion: '1.21.1', forgeVersion: '52.0.16', type: 'release', loader: 'forge' },
      { id: '1.20.1-forge-47.3.0', mcVersion: '1.20.1', forgeVersion: '47.3.0', type: 'release', loader: 'forge' },
      { id: '1.20.1-forge-47.2.20', mcVersion: '1.20.1', forgeVersion: '47.2.20', type: 'release', loader: 'forge' },
      { id: '1.20.1-forge-47.2.0', mcVersion: '1.20.1', forgeVersion: '47.2.0', type: 'release', loader: 'forge' },
      { id: '1.20-forge-46.0.14', mcVersion: '1.20', forgeVersion: '46.0.14', type: 'release', loader: 'forge' },
      { id: '1.19.4-forge-45.2.0', mcVersion: '1.19.4', forgeVersion: '45.2.0', type: 'release', loader: 'forge' },
      { id: '1.19.4-forge-45.1.0', mcVersion: '1.19.4', forgeVersion: '45.1.0', type: 'release', loader: 'forge' },
      { id: '1.19.3-forge-44.1.23', mcVersion: '1.19.3', forgeVersion: '44.1.23', type: 'release', loader: 'forge' },
      { id: '1.19.2-forge-43.3.5', mcVersion: '1.19.2', forgeVersion: '43.3.5', type: 'release', loader: 'forge' },
      { id: '1.19.2-forge-43.2.0', mcVersion: '1.19.2', forgeVersion: '43.2.0', type: 'release', loader: 'forge' },
      { id: '1.18.2-forge-40.2.9', mcVersion: '1.18.2', forgeVersion: '40.2.9', type: 'release', loader: 'forge' },
      { id: '1.18.2-forge-40.2.0', mcVersion: '1.18.2', forgeVersion: '40.2.0', type: 'release', loader: 'forge' },
      { id: '1.18.1-forge-39.1.2', mcVersion: '1.18.1', forgeVersion: '39.1.2', type: 'release', loader: 'forge' },
      { id: '1.17.1-forge-37.1.1', mcVersion: '1.17.1', forgeVersion: '37.1.1', type: 'release', loader: 'forge' },
      { id: '1.16.5-forge-36.2.39', mcVersion: '1.16.5', forgeVersion: '36.2.39', type: 'release', loader: 'forge' },
      { id: '1.16.5-forge-36.2.0', mcVersion: '1.16.5', forgeVersion: '36.2.0', type: 'release', loader: 'forge' },
      { id: '1.15.2-forge-31.2.57', mcVersion: '1.15.2', forgeVersion: '31.2.57', type: 'release', loader: 'forge' },
      { id: '1.14.4-forge-28.2.0', mcVersion: '1.14.4', forgeVersion: '28.2.0', type: 'release', loader: 'forge' },
      { id: '1.13.2-forge-25.0.219', mcVersion: '1.13.2', forgeVersion: '25.0.219', type: 'release', loader: 'forge' },
      { id: '1.12.2-forge-14.23.5.2860', mcVersion: '1.12.2', forgeVersion: '14.23.5.2860', type: 'release', loader: 'forge' },
      { id: '1.12.2-forge-14.23.5.2854', mcVersion: '1.12.2', forgeVersion: '14.23.5.2854', type: 'release', loader: 'forge' },
      { id: '1.11.2-forge-13.20.1.2588', mcVersion: '1.11.2', forgeVersion: '13.20.1.2588', type: 'release', loader: 'forge' },
      { id: '1.10.2-forge-12.18.3.2511', mcVersion: '1.10.2', forgeVersion: '12.18.3.2511', type: 'release', loader: 'forge' },
      { id: '1.9.4-forge-12.17.0.2317', mcVersion: '1.9.4', forgeVersion: '12.17.0.2317', type: 'release', loader: 'forge' },
      { id: '1.8.9-forge-11.15.1.2318', mcVersion: '1.8.9', forgeVersion: '11.15.1.2318', type: 'release', loader: 'forge' },
      { id: '1.7.10-forge-10.13.4.1614', mcVersion: '1.7.10', forgeVersion: '10.13.4.1614', type: 'release', loader: 'forge' },
      { id: '1.7.10-forge-10.13.4.1558', mcVersion: '1.7.10', forgeVersion: '10.13.4.1558', type: 'release', loader: 'forge' },
    ];
  }

  async getFabricVersions() {
    if (this.fabricVersionsCache) {
      return this.fabricVersionsCache;
    }

    try {
      const gameVersionsRes = await axios.get('https://meta.fabricmc.net/v2/versions/game');
      const loaderVersionsRes = await axios.get('https://meta.fabricmc.net/v2/versions/loader');

      const gameVersions = gameVersionsRes.data;
      const loaderVersions = loaderVersionsRes.data;

      if (!gameVersions || !loaderVersions || loaderVersions.length === 0) {
        console.error('No Fabric versions found');
        return this.getFallbackFabricVersions();
      }

      const versions = [];
      const latestLoader = loaderVersions[0].version;

      const stableGames = gameVersions.filter(v => v.stable).slice(0, 50);

      for (const game of stableGames) {
        versions.push({
          id: `${game.version}-fabric-${latestLoader}`,
          mcVersion: game.version,
          fabricVersion: latestLoader,
          type: 'stable',
          loader: 'fabric'
        });
      }

      this.fabricVersionsCache = versions;
      return versions;
    } catch (error) {
      console.error('Error fetching Fabric versions:', error);
      return this.getFallbackFabricVersions();
    }
  }

  getFallbackFabricVersions() {
    return [
      { id: '1.21.1-fabric-0.16.9', mcVersion: '1.21.1', fabricVersion: '0.16.9', type: 'stable', loader: 'fabric' },
      { id: '1.21-fabric-0.16.9', mcVersion: '1.21', fabricVersion: '0.16.9', type: 'stable', loader: 'fabric' },
      { id: '1.20.6-fabric-0.16.0', mcVersion: '1.20.6', fabricVersion: '0.16.0', type: 'stable', loader: 'fabric' },
      { id: '1.20.5-fabric-0.15.11', mcVersion: '1.20.5', fabricVersion: '0.15.11', type: 'stable', loader: 'fabric' },
      { id: '1.20.4-fabric-0.15.6', mcVersion: '1.20.4', fabricVersion: '0.15.6', type: 'stable', loader: 'fabric' },
      { id: '1.20.3-fabric-0.15.3', mcVersion: '1.20.3', fabricVersion: '0.15.3', type: 'stable', loader: 'fabric' },
      { id: '1.20.2-fabric-0.15.3', mcVersion: '1.20.2', fabricVersion: '0.15.3', type: 'stable', loader: 'fabric' },
      { id: '1.20.1-fabric-0.15.11', mcVersion: '1.20.1', fabricVersion: '0.15.11', type: 'stable', loader: 'fabric' },
      { id: '1.20.1-fabric-0.15.0', mcVersion: '1.20.1', fabricVersion: '0.15.0', type: 'stable', loader: 'fabric' },
      { id: '1.20-fabric-0.14.25', mcVersion: '1.20', fabricVersion: '0.14.25', type: 'stable', loader: 'fabric' },
      { id: '1.19.4-fabric-0.14.21', mcVersion: '1.19.4', fabricVersion: '0.14.21', type: 'stable', loader: 'fabric' },
      { id: '1.19.3-fabric-0.14.17', mcVersion: '1.19.3', fabricVersion: '0.14.17', type: 'stable', loader: 'fabric' },
      { id: '1.19.2-fabric-0.14.9', mcVersion: '1.19.2', fabricVersion: '0.14.9', type: 'stable', loader: 'fabric' },
      { id: '1.18.2-fabric-0.14.21', mcVersion: '1.18.2', fabricVersion: '0.14.21', type: 'stable', loader: 'fabric' },
      { id: '1.18.1-fabric-0.14.9', mcVersion: '1.18.1', fabricVersion: '0.14.9', type: 'stable', loader: 'fabric' },
      { id: '1.17.1-fabric-0.14.21', mcVersion: '1.17.1', fabricVersion: '0.14.21', type: 'stable', loader: 'fabric' },
      { id: '1.16.5-fabric-0.14.21', mcVersion: '1.16.5', fabricVersion: '0.14.21', type: 'stable', loader: 'fabric' },
      { id: '1.14.4-fabric-0.14.21', mcVersion: '1.14.4', fabricVersion: '0.14.21', type: 'stable', loader: 'fabric' },
      { id: '1.13.2-fabric-0.14.21', mcVersion: '1.13.2', fabricVersion: '0.14.21', type: 'stable', loader: 'fabric' },
      { id: '1.12.2-fabric-0.14.21', mcVersion: '1.12.2', fabricVersion: '0.14.21', type: 'stable', loader: 'fabric' },
    ];
  }

  async getOptiFineVersions() {
    return [
      { id: '1.21.1-optifine-HD_U_J3', mcVersion: '1.21.1', optifineVersion: 'HD_U_J3', type: 'HD Ultra', loader: 'optifine' },
      { id: '1.21.1-optifine-HD_U_J2', mcVersion: '1.21.1', optifineVersion: 'HD_U_J2', type: 'HD Ultra', loader: 'optifine' },
      { id: '1.21-optifine-HD_U_J1', mcVersion: '1.21', optifineVersion: 'HD_U_J1', type: 'HD Ultra', loader: 'optifine' },
      { id: '1.20.6-optifine-HD_U_I9', mcVersion: '1.20.6', optifineVersion: 'HD_U_I9', type: 'HD Ultra', loader: 'optifine' },
      { id: '1.20.5-optifine-HD_U_I9', mcVersion: '1.20.5', optifineVersion: 'HD_U_I9', type: 'HD Ultra', loader: 'optifine' },
      { id: '1.20.4-optifine-HD_U_I8', mcVersion: '1.20.4', optifineVersion: 'HD_U_I8', type: 'HD Ultra', loader: 'optifine' },
      { id: '1.20.3-optifine-HD_U_I7', mcVersion: '1.20.3', optifineVersion: 'HD_U_I7', type: 'HD Ultra', loader: 'optifine' },
      { id: '1.20.2-optifine-HD_U_I7', mcVersion: '1.20.2', optifineVersion: 'HD_U_I7', type: 'HD Ultra', loader: 'optifine' },
      { id: '1.20.1-optifine-HD_U_I6', mcVersion: '1.20.1', optifineVersion: 'HD_U_I6', type: 'HD Ultra', loader: 'optifine' },
      { id: '1.20.1-optifine-HD_U_I5', mcVersion: '1.20.1', optifineVersion: 'HD_U_I5', type: 'HD Ultra', loader: 'optifine' },
      { id: '1.20-optifine-HD_U_I5', mcVersion: '1.20', optifineVersion: 'HD_U_I5', type: 'HD Ultra', loader: 'optifine' },
      { id: '1.19.4-optifine-HD_U_I4', mcVersion: '1.19.4', optifineVersion: 'HD_U_I4', type: 'HD Ultra', loader: 'optifine' },
      { id: '1.19.4-optifine-HD_U_I3', mcVersion: '1.19.4', optifineVersion: 'HD_U_I3', type: 'HD Ultra', loader: 'optifine' },
      { id: '1.19.3-optifine-HD_U_I2', mcVersion: '1.19.3', optifineVersion: 'HD_U_I2', type: 'HD Ultra', loader: 'optifine' },
      { id: '1.19.2-optifine-HD_U_H9', mcVersion: '1.19.2', optifineVersion: 'HD_U_H9', type: 'HD Ultra', loader: 'optifine' },
      { id: '1.19.2-optifine-HD_U_H7', mcVersion: '1.19.2', optifineVersion: 'HD_U_H7', type: 'HD Ultra', loader: 'optifine' },
      { id: '1.19.1-optifine-HD_U_H8', mcVersion: '1.19.1', optifineVersion: 'HD_U_H8', type: 'HD Ultra', loader: 'optifine' },
      { id: '1.19-optifine-HD_U_H8', mcVersion: '1.19', optifineVersion: 'HD_U_H8', type: 'HD Ultra', loader: 'optifine' },
      { id: '1.18.2-optifine-HD_U_H9', mcVersion: '1.18.2', optifineVersion: 'HD_U_H9', type: 'HD Ultra', loader: 'optifine' },
      { id: '1.18.2-optifine-HD_U_H7', mcVersion: '1.18.2', optifineVersion: 'HD_U_H7', type: 'HD Ultra', loader: 'optifine' },
      { id: '1.18.1-optifine-HD_U_H6', mcVersion: '1.18.1', optifineVersion: 'HD_U_H6', type: 'HD Ultra', loader: 'optifine' },
      { id: '1.18-optifine-HD_U_H4', mcVersion: '1.18', optifineVersion: 'HD_U_H4', type: 'HD Ultra', loader: 'optifine' },
      { id: '1.17.1-optifine-HD_U_H1', mcVersion: '1.17.1', optifineVersion: 'HD_U_H1', type: 'HD Ultra', loader: 'optifine' },
      { id: '1.17-optifine-HD_U_G9', mcVersion: '1.17', optifineVersion: 'HD_U_G9', type: 'HD Ultra', loader: 'optifine' },
      { id: '1.16.5-optifine-HD_U_G8', mcVersion: '1.16.5', optifineVersion: 'HD_U_G8', type: 'HD Ultra', loader: 'optifine' },
      { id: '1.16.5-optifine-HD_U_G7', mcVersion: '1.16.5', optifineVersion: 'HD_U_G7', type: 'HD Ultra', loader: 'optifine' },
      { id: '1.16.4-optifine-HD_U_G5', mcVersion: '1.16.4', optifineVersion: 'HD_U_G5', type: 'HD Ultra', loader: 'optifine' },
      { id: '1.16.3-optifine-HD_U_G4', mcVersion: '1.16.3', optifineVersion: 'HD_U_G4', type: 'HD Ultra', loader: 'optifine' },
      { id: '1.16.2-optifine-HD_U_G3', mcVersion: '1.16.2', optifineVersion: 'HD_U_G3', type: 'HD Ultra', loader: 'optifine' },
      { id: '1.16.1-optifine-HD_U_G2', mcVersion: '1.16.1', optifineVersion: 'HD_U_G2', type: 'HD Ultra', loader: 'optifine' },
      { id: '1.15.2-optifine-HD_U_G2', mcVersion: '1.15.2', optifineVersion: 'HD_U_G2', type: 'HD Ultra', loader: 'optifine' },
      { id: '1.15.2-optifine-HD_U_G1', mcVersion: '1.15.2', optifineVersion: 'HD_U_G1', type: 'HD Ultra', loader: 'optifine' },
      { id: '1.14.4-optifine-HD_U_F5', mcVersion: '1.14.4', optifineVersion: 'HD_U_F5', type: 'HD Ultra', loader: 'optifine' },
      { id: '1.13.2-optifine-HD_U_F4', mcVersion: '1.13.2', optifineVersion: 'HD_U_F4', type: 'HD Ultra', loader: 'optifine' },
      { id: '1.12.2-optifine-HD_U_G5', mcVersion: '1.12.2', optifineVersion: 'HD_U_G5', type: 'HD Ultra', loader: 'optifine' },
      { id: '1.12.2-optifine-HD_U_G2', mcVersion: '1.12.2', optifineVersion: 'HD_U_G2', type: 'HD Ultra', loader: 'optifine' },
      { id: '1.11.2-optifine-HD_U_F3', mcVersion: '1.11.2', optifineVersion: 'HD_U_F3', type: 'HD Ultra', loader: 'optifine' },
      { id: '1.10.2-optifine-HD_U_I3', mcVersion: '1.10.2', optifineVersion: 'HD_U_I3', type: 'HD Ultra', loader: 'optifine' },
      { id: '1.9.4-optifine-HD_U_I3', mcVersion: '1.9.4', optifineVersion: 'HD_U_I3', type: 'HD Ultra', loader: 'optifine' },
      { id: '1.8.9-optifine-HD_U_M5', mcVersion: '1.8.9', optifineVersion: 'HD_U_M5', type: 'HD Ultra', loader: 'optifine' },
      { id: '1.8.9-optifine-HD_U_M2', mcVersion: '1.8.9', optifineVersion: 'HD_U_M2', type: 'HD Ultra', loader: 'optifine' },
      { id: '1.7.10-optifine-HD_U_E7', mcVersion: '1.7.10', optifineVersion: 'HD_U_E7', type: 'HD Ultra', loader: 'optifine' },
      { id: '1.7.10-optifine-HD_U_E3', mcVersion: '1.7.10', optifineVersion: 'HD_U_E3', type: 'HD Ultra', loader: 'optifine' },
    ];
  }

  async getNeoForgeVersions() {
    if (this.neoforgeVersionsCache) {
      return this.neoforgeVersionsCache;
    }

    try {
      const response = await axios.get('https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge');
      const versions = response.data.versions || [];

      const neoForgeVersions = [];
      const mcVersionMap = new Map();

      const neoforgeToMcMap = (ver) => {
        const parts = ver.split('.').map(Number);
        if (parts[0] >= 47 && parts[0] <= 48) return '1.20.1';
        if (parts[0] === 20 && parts[1] >= 2 && parts[1] <= 2) return '1.20.2';
        if (parts[0] === 20 && parts[1] >= 3 && parts[1] <= 3) return '1.20.3';
        if (parts[0] === 20 && parts[1] >= 4 && parts[1] <= 4) return '1.20.4';
        if (parts[0] === 20 && parts[1] >= 5 && parts[1] <= 6) return '1.20.6';
        if (parts[0] === 21 && parts[1] === 0) return '1.21';
        if (parts[0] === 21 && parts[1] >= 1) return '1.21.1';
        return `1.${parts[0]}.${parts[1]}`;
      };

      versions.forEach(version => {
        const mcVersion = neoforgeToMcMap(version);
        if (!mcVersionMap.has(mcVersion)) {
          mcVersionMap.set(mcVersion, []);
        }
        mcVersionMap.get(mcVersion).push({
          id: `${mcVersion}-neoforge-${version}`,
          mcVersion: mcVersion,
          neoforgeVersion: version,
          type: 'release',
          loader: 'neoforge'
        });
      });

      const mcOrder = ['1.21.1', '1.21', '1.20.6', '1.20.4', '1.20.3', '1.20.2', '1.20.1'];
      for (const mcVer of mcOrder) {
        if (mcVersionMap.has(mcVer)) {
          const vers = mcVersionMap.get(mcVer);
          vers.sort((a, b) => {
            const pa = a.neoforgeVersion.split('.').map(Number);
            const pb = b.neoforgeVersion.split('.').map(Number);
            for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
              if ((pa[i] || 0) !== (pb[i] || 0)) return (pb[i] || 0) - (pa[i] || 0);
            }
            return 0;
          });
          for (const v of vers.slice(0, 3)) {
            neoForgeVersions.push(v);
          }
        }
      }

      for (const [mcVer, vers] of mcVersionMap.entries()) {
        if (!mcOrder.includes(mcVer)) {
          for (const v of vers.slice(0, 2)) {
            neoForgeVersions.push(v);
          }
        }
      }

      this.neoforgeVersionsCache = neoForgeVersions;
      return this.neoforgeVersionsCache;
    } catch (error) {
      console.error('Error fetching NeoForge versions:', error);
      return this.getFallbackNeoForgeVersions();
    }
  }

  getFallbackNeoForgeVersions() {
    return [
      { id: '1.21.1-neoforge-21.1.77', mcVersion: '1.21.1', neoforgeVersion: '21.1.77', type: 'release', loader: 'neoforge' },
      { id: '1.21-neoforge-21.0.167', mcVersion: '1.21', neoforgeVersion: '21.0.167', type: 'release', loader: 'neoforge' },
      { id: '1.21-neoforge-21.0.42', mcVersion: '1.21', neoforgeVersion: '21.0.42', type: 'release', loader: 'neoforge' },
      { id: '1.20.6-neoforge-20.6.213', mcVersion: '1.20.6', neoforgeVersion: '20.6.213', type: 'release', loader: 'neoforge' },
      { id: '1.20.6-neoforge-20.6.119', mcVersion: '1.20.6', neoforgeVersion: '20.6.119', type: 'release', loader: 'neoforge' },
      { id: '1.20.4-neoforge-20.4.237', mcVersion: '1.20.4', neoforgeVersion: '20.4.237', type: 'release', loader: 'neoforge' },
      { id: '1.20.4-neoforge-20.4.210', mcVersion: '1.20.4', neoforgeVersion: '20.4.210', type: 'release', loader: 'neoforge' },
      { id: '1.20.3-neoforge-20.3.108', mcVersion: '1.20.3', neoforgeVersion: '20.3.108', type: 'release', loader: 'neoforge' },
      { id: '1.20.2-neoforge-20.2.88', mcVersion: '1.20.2', neoforgeVersion: '20.2.88', type: 'release', loader: 'neoforge' },
      { id: '1.20.1-neoforge-47.1.106', mcVersion: '1.20.1', neoforgeVersion: '47.1.106', type: 'release', loader: 'neoforge' },
      { id: '1.20.1-neoforge-47.1.100', mcVersion: '1.20.1', neoforgeVersion: '47.1.100', type: 'release', loader: 'neoforge' },
    ];
  }

  async getQuiltVersions() {
    if (this.quiltVersionsCache) {
      return this.quiltVersionsCache;
    }

    try {
      const gameVersionsRes = await axios.get('https://meta.quiltmc.org/v3/versions/game');
      const loaderVersionsRes = await axios.get('https://meta.quiltmc.org/v3/versions/loader');

      const gameVersions = gameVersionsRes.data;
      const loaderVersions = loaderVersionsRes.data;

      if (!gameVersions || !loaderVersions || loaderVersions.length === 0) {
        console.error('No Quilt versions found');
        return this.getFallbackQuiltVersions();
      }

      const versions = [];
      const latestLoader = loaderVersions[0].version;

      const stableGames = gameVersions.filter(v => v.stable).slice(0, 50);

      for (const game of stableGames) {
        versions.push({
          id: `${game.version}-quilt-${latestLoader}`,
          mcVersion: game.version,
          quiltVersion: latestLoader,
          type: 'stable',
          loader: 'quilt'
        });
      }

      this.quiltVersionsCache = versions;
      return versions;
    } catch (error) {
      console.error('Error fetching Quilt versions:', error);
      return this.getFallbackQuiltVersions();
    }
  }

  getFallbackQuiltVersions() {
    return [
      { id: '1.21.1-quilt-0.27.0', mcVersion: '1.21.1', quiltVersion: '0.27.0', type: 'stable', loader: 'quilt' },
      { id: '1.21-quilt-0.27.0', mcVersion: '1.21', quiltVersion: '0.27.0', type: 'stable', loader: 'quilt' },
      { id: '1.20.6-quilt-0.26.0', mcVersion: '1.20.6', quiltVersion: '0.26.0', type: 'stable', loader: 'quilt' },
      { id: '1.20.5-quilt-0.26.0', mcVersion: '1.20.5', quiltVersion: '0.26.0', type: 'stable', loader: 'quilt' },
      { id: '1.20.4-quilt-0.25.0', mcVersion: '1.20.4', quiltVersion: '0.25.0', type: 'stable', loader: 'quilt' },
      { id: '1.20.3-quilt-0.25.0', mcVersion: '1.20.3', quiltVersion: '0.25.0', type: 'stable', loader: 'quilt' },
      { id: '1.20.2-quilt-0.24.0', mcVersion: '1.20.2', quiltVersion: '0.24.0', type: 'stable', loader: 'quilt' },
      { id: '1.20.1-quilt-0.24.0', mcVersion: '1.20.1', quiltVersion: '0.24.0', type: 'stable', loader: 'quilt' },
      { id: '1.20-quilt-0.23.0', mcVersion: '1.20', quiltVersion: '0.23.0', type: 'stable', loader: 'quilt' },
      { id: '1.19.4-quilt-0.23.0', mcVersion: '1.19.4', quiltVersion: '0.23.0', type: 'stable', loader: 'quilt' },
      { id: '1.19.3-quilt-0.22.0', mcVersion: '1.19.3', quiltVersion: '0.22.0', type: 'stable', loader: 'quilt' },
      { id: '1.19.2-quilt-0.21.0', mcVersion: '1.19.2', quiltVersion: '0.21.0', type: 'stable', loader: 'quilt' },
      { id: '1.19.1-quilt-0.20.0', mcVersion: '1.19.1', quiltVersion: '0.20.0', type: 'stable', loader: 'quilt' },
      { id: '1.19-quilt-0.19.0', mcVersion: '1.19', quiltVersion: '0.19.0', type: 'stable', loader: 'quilt' },
      { id: '1.18.2-quilt-0.18.0', mcVersion: '1.18.2', quiltVersion: '0.18.0', type: 'stable', loader: 'quilt' },
      { id: '1.18.1-quilt-0.17.0', mcVersion: '1.18.1', quiltVersion: '0.17.0', type: 'stable', loader: 'quilt' },
      { id: '1.18-quilt-0.17.0', mcVersion: '1.18', quiltVersion: '0.17.0', type: 'stable', loader: 'quilt' },
      { id: '1.17.1-quilt-0.16.0', mcVersion: '1.17.1', quiltVersion: '0.16.0', type: 'stable', loader: 'quilt' },
      { id: '1.16.5-quilt-0.14.0', mcVersion: '1.16.5', quiltVersion: '0.14.0', type: 'stable', loader: 'quilt' },
    ];
  }

  async getAllVersions(vanillaVersions) {
    console.log('Fetching all mod loader versions...');

    const [forge, fabric, optifine, neoforge, quilt] = await Promise.all([
      this.getForgeVersions(),
      this.getFabricVersions(),
      this.getOptiFineVersions(),
      this.getNeoForgeVersions(),
      this.getQuiltVersions()
    ]);

    console.log(`Loaded: ${forge.length} Forge, ${fabric.length} Fabric, ${optifine.length} OptiFine, ${neoforge.length} NeoForge, ${quilt.length} Quilt versions`);

    return {
      vanilla: vanillaVersions,
      forge: forge,
      fabric: fabric,
      optifine: optifine,
      neoforge: neoforge,
      quilt: quilt
    };
  }
}

module.exports = ModLoaderAPI;
