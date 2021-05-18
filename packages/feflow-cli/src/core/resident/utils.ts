// 更新依赖
import fs from 'fs';
import path from 'path';
import osenv from 'osenv';
import spawn from 'cross-spawn';
import packageJson from '../../shared/packageJson';
import {
  FEFLOW_ROOT,
  UNIVERSAL_MODULES,
  LATEST_VERSION
} from '../../shared/constant';
import { getCurrentTag } from '../universal-pkg/repository/git';
import loggerInstance from '../logger';
import versionImpl from '../universal-pkg/dep/version';

interface VersionObj {
  name: string;
  localVersion: any;
  latestVersion: any;
  repoPath: string;
  installVersion: any;
}

const { debug, silent } = process.env;
const root = path.join(osenv.home(), FEFLOW_ROOT);
const rootPkg = path.join(root, 'package.json');
const universalModulesPath = path.join(root, UNIVERSAL_MODULES);

const logger = loggerInstance({
  debug: Boolean(debug),
  silent: Boolean(silent)
});

export const getInstalledPlugins = () => {
  let plugins: any = [];
  const exist = fs.existsSync(rootPkg);
  const pluginDir = path.join(root, 'node_modules');

  if (!exist) {
    plugins = [];
  } else {
    const content: any = fs.readFileSync(rootPkg);

    let json: any;

    try {
      json = JSON.parse(content);
      const deps = json.dependencies || json.devDependencies || {};

      plugins = Object.keys(deps);
    } catch (ex) {
      plugins = [];
    }
  }
  return plugins.filter((name: any) => {
    if (
      !/^feflow-plugin-|^@[^/]+\/feflow-plugin-|generator-|^@[^/]+\/generator-/.test(
        name
      )
    ) {
      return false;
    }
    const pathFn = path.join(pluginDir, name);
    return fs.existsSync(pathFn);
  });
};

export const getNpmRegistryUrl = (packageManager: string) => {
  return spawn
    .sync(packageManager, ['config', 'get', 'registry'], { windowsHide: true })
    .stdout.toString()
    .replace(/\n/, '')
    .replace(/\/$/, '');
};

export const getLatestVersion = async (
  name: string,
  packageManager: string
) => {
  const registryUrl = getNpmRegistryUrl(packageManager);
  return await packageJson(name, registryUrl).catch(() => {
    logger.warn(
      `Network error, can't reach ${registryUrl}, CLI give up verison check.`
    );
  });
};

export const updatePluginsVersion = (packagePath: string, plugins: any) => {
  const obj = require(packagePath);

  plugins.map((plugin: any) => {
    obj.dependencies[plugin.name] = plugin.latestVersion;
  });

  fs.writeFileSync(packagePath, JSON.stringify(obj, null, 4));
};

export const getUniversalPluginVersion = (pkgInfo: any, universalPkg: any) => {
  return new Promise<VersionObj>(async resolve => {
    const repoPath = path.join(
      universalModulesPath,
      `${pkgInfo.repoName}@${pkgInfo.installVersion}`
    );
    if (pkgInfo.installVersion === LATEST_VERSION) {
      if (universalPkg.isInstalled(pkgInfo.repoName, LATEST_VERSION)) {
        const currentVersion = (await getCurrentTag(repoPath)) || '';
        logger.debug(
          `repoPath => ${repoPath}; currentVersion => ${currentVersion}; checkoutTag=> ${pkgInfo.checkoutTag}`
        );
        if (versionImpl.gt(pkgInfo.checkoutTag, currentVersion)) {
          resolve({
            name: pkgInfo.repoName,
            localVersion: currentVersion,
            latestVersion: pkgInfo.checkoutTag,
            repoPath,
            installVersion: pkgInfo.installVersion
          });
        }
      }
    }
    resolve({
      name: pkgInfo.repoName,
      localVersion: '',
      latestVersion: '',
      repoPath,
      installVersion: pkgInfo.installVersion
    });
  });
};

export const promisify = (asyncFun: Function, ...args: any) => {
  return () => {
    return new Promise<undefined>(async resolve => {
      await asyncFun(...args);
      resolve();
    });
  };
};
