/* eslint-disable @typescript-eslint/camelcase */
import fs from 'fs';
import path from 'path';
import semver from 'semver';
import osenv from 'osenv';
import spawn from 'cross-spawn';
import _ from 'lodash';
import LockFileInstance from '../../shared/lockFile';
import packageJson from '../../shared/packageJson';
import { parseYaml } from '../../shared/yaml';
import { setServerUrl } from '../../shared/git';
import { UniversalPkg } from '../universal-pkg/dep/pkg';
import {
  HEART_BEAT_COLLECTION,
  UPDATE_COLLECTION,
  BEAT_GAP,
  CHECK_UPDATE_GAP,
  FEFLOW_ROOT,
  UNIVERSAL_PKG_JSON,
  BEAT_KEY,
  BEAT_LOCK,
  UPDATE_KEY,
  UPDATE_LOCK
} from '../../shared/constant';
import loggerInstance from '../logger';
import {
  getInstalledPlugins,
  getLatestVersion,
  getUniversalPluginVersion
} from './utils';
interface ErrorInstance {
  name: string;
  message: string;
  stack: string;
}

const pkg = require('../../../package.json');
const { getPkgInfo } = require('../native/install');
const version = pkg.version;

const { debug, silent } = process.env;
const root = path.join(osenv.home(), FEFLOW_ROOT);
const configPath = path.join(root, '.feflowrc.yml');
const universalPkgPath = path.join(root, UNIVERSAL_PKG_JSON);
const dbFile = path.join(root, UPDATE_COLLECTION);
const updateFile = new LockFileInstance(dbFile, UPDATE_LOCK);
const heartDBFile = path.join(root, HEART_BEAT_COLLECTION);
const heartFile = new LockFileInstance(heartDBFile, BEAT_LOCK);
const logger = loggerInstance({
  debug: Boolean(debug),
  silent: Boolean(silent)
});

// 设置特殊的静默进程名字
process.title = 'feflow-update-beat-proccess';

const handleException = (e: ErrorInstance): void => {
  logger.error(`update_beat_exception: ${e.name}: ${e.message} => ${e.stack}`);
};

(process as NodeJS.EventEmitter).on('uncaughtException', handleException);

(process as NodeJS.EventEmitter).on('unhandledRejection', handleException);

const heartBeat = () => {
  heartFile.update(BEAT_KEY, String(new Date().getTime()));
};

const queryCliUpdate = async () => {
  const config = parseYaml(configPath);

  if (!config) {
    return;
  }
  if (
    config['lastUpdateCheck'] &&
    +new Date() - parseInt(config['lastUpdateCheck'], 10) <= 1000 * 3600 * 24
  ) {
    return;
  }

  if (config['autoUpdate'] !== 'true') {
    return;
  }

  const latestVersion: any = await getLatestVersion(
    '@feflow/cli',
    config['packageManager']
  );
  if (latestVersion && semver.gt(latestVersion, version)) {
    const updateData: any = await updateFile.read(UPDATE_KEY);
    if (updateData.latest_cli_version !== latestVersion) {
      const newUpdateData = {
        ...updateData,
        latest_cli_version: latestVersion
      };
      await updateFile.update(UPDATE_KEY, newUpdateData);
    }
  }
};

const queryPluginsUpdate = async () => {
  const config = parseYaml(configPath);
  if (!config) {
    return;
  }

  Promise.all(
    getInstalledPlugins().map(async (name: any) => {
      const pluginPath = path.join(root, 'node_modules', name, 'package.json');
      const content: any = fs.readFileSync(pluginPath);
      const pkg: any = JSON.parse(content);
      const localVersion = pkg.version;
      const registryUrl = spawn
        .sync(config['packageManager'], ['config', 'get', 'registry'], {
          windowsHide: true
        })
        .stdout.toString()
        .replace(/\n/, '')
        .replace(/\/$/, '');
      const latestVersion = await packageJson(name, registryUrl).catch(
        (err: any) => {
          logger.debug('Check plugin update error', err);
        }
      );

      if (latestVersion && semver.gt(latestVersion, localVersion)) {
        return {
          name,
          latestVersion,
          localVersion
        };
      } else {
        logger.debug('All plugins is in latest version');
      }
    })
  ).then(async (plugins: any) => {
    plugins = plugins.filter((plugin: any) => {
      return plugin && plugin.name;
    });
    logger.debug('tnpm plugins update infomation', plugins);
    if (plugins.length) {
      const updateData: any = await updateFile.read(UPDATE_KEY);
      if (!_.isEqual(updateData.latest_plugins, plugins)) {
        const newUpdateData = {
          ...updateData,
          latest_plugins: plugins
        };
        await updateFile.update(UPDATE_KEY, newUpdateData);
      }
    }
  });
};

const queryUniversalPluginsUpdate = async () => {
  const config = parseYaml(configPath);
  if (!config || !config['serverUrl']) {
    return;
  }
  setServerUrl(config['serverUrl']);

  const universalPkg = new UniversalPkg(universalPkgPath);
  const latestUniversalPlugins: any[] = [];

  // eslint-disable-next-line
  for (const [pkg, version] of universalPkg.getInstalled()) {
    const pkgInfo = await getPkgInfo(
      { root, config, logger },
      `${pkg}@${version}`
    ).catch(async (e: string) => {
      logger.error(`update_error => pkg: ${pkg}@${version} => error: ${e}`);
    });
    if (!pkgInfo) {
      continue;
    }
    const versionObj = await getUniversalPluginVersion(pkgInfo, universalPkg);
    if (versionObj.latestVersion) {
      latestUniversalPlugins.push(versionObj);
    }
  }

  logger.debug('universal plugins update infomation', latestUniversalPlugins);
  if (latestUniversalPlugins.length) {
    const updateData: any = await updateFile.read(UPDATE_KEY);
    if (
      !_.isEqual(updateData.latest_universal_plugins, latestUniversalPlugins)
    ) {
      const newUpdateData = {
        ...updateData,
        latest_universal_plugins: latestUniversalPlugins
      };
      await updateFile.update(UPDATE_KEY, newUpdateData);
    }
  }
};

// startBeat
setInterval(heartBeat, BEAT_GAP);

// queryCliUpdate
setInterval(() => {
  queryCliUpdate().catch(handleException);
}, CHECK_UPDATE_GAP);

// queryPluginsUpdate
setInterval(() => {
  queryPluginsUpdate().catch(handleException);
}, CHECK_UPDATE_GAP);

// queryUniversalPluginsUpdate
setInterval(() => {
  queryUniversalPluginsUpdate().catch(handleException);
}, CHECK_UPDATE_GAP);
