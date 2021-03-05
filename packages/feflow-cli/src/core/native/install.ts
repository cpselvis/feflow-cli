import { getRegistryUrl, install } from '../../shared/npm';
import fs from 'fs';
import path from 'path';
import rp from 'request-promise';
import packageJson from '../../shared/packageJson';
import {
  getTag,
  checkoutVersion,
  getCurrentTag
} from '../universal-pkg/repository/git';
import { download } from '../../shared/git';
import {
  HOOK_TYPE_ON_COMMAND_REGISTERED,
  LATEST_VERSION,
  FEFLOW_BIN,
  FEFLOW_LIB,
  NPM_PLUGIN_INFO_JSON,
  INVALID_VERSION,
  FEFLOW_PLUGIN_GIT_PREFIX,
  FEFLOW_PLUGIN_PREFIX,
  FEFLOW_PLUGIN_LOCAL_PREFIX
} from '../../shared/constant';
import { Plugin } from '../universal-pkg/schema/plugin';
import Linker from '../universal-pkg/linker';
import { UniversalPkg } from '../universal-pkg/dep/pkg';
import versionImpl from '../universal-pkg/dep/version';
import applyPlugins, { resolvePlugin } from '../plugin/applyPlugins';
import CommandPickConfig from '../command-picker/pickConfig';
import { getURL } from '../../shared/url';
import { copyDir } from '../../shared/fs';
// import loggerReport from '../logger/report';

async function getRepoInfo(ctx: any, packageName: string) {
  const serverUrl = ctx.config?.serverUrl;
  const url = getURL(serverUrl, `apply/getlist?name=${packageName}`);
  if (!url) {
    return Promise.reject('the serverUrl is invalid: ' + serverUrl);
  }
  const options = {
    url,
    method: 'GET'
  };
  return rp(options)
    .then((response: any) => {
      const data = JSON.parse(response);
      return data.data && data.data[0];
    })
    .catch((err: any) => {
      ctx.logger.debug('Get repo info error', err);
    });
}

// git@github.com:tencent/feflow.git
// or http[s]://github.com/tencent/feflow.git or http[s]://user:pwd@github.com/tencent/feflow.git
// to
// github.com:tencent:feflow
function getGitRepoName(repoUrl: string): string | undefined {
  const ret = /^((http:\/\/|https:\/\/)(.*?@)?|git@)/.exec(repoUrl);
  if (Array.isArray(ret) && ret.length > 0) {
    repoUrl = repoUrl.substring(ret[0].length);
  }
  const end = '.git';
  if (repoUrl.endsWith(end)) {
    repoUrl = repoUrl.substring(0, repoUrl.length - end.length);
  }
  return FEFLOW_PLUGIN_GIT_PREFIX + repoUrl.split('/').join('::');
}

function getDirRepoName(dir: string): string {
  return (
    FEFLOW_PLUGIN_LOCAL_PREFIX +
    dir
      .toLowerCase()
      .trim()
      .split(path.sep)
      .join('::')
  );
}

function deleteDir(dirPath: string) {
  let files: any = [];
  try {
    const dirStats = fs.statSync(dirPath);
    if (!dirStats.isDirectory()) {
      return;
    }
  } catch (e) {
    return;
  }
  files = fs.readdirSync(dirPath);
  files.forEach((file: string) => {
    const curPath = dirPath + '/' + file;
    const stat = fs.statSync(curPath);
    if (stat.isDirectory()) {
      deleteDir(curPath);
    } else {
      fs.unlinkSync(curPath);
    }
  });
  const stat = fs.lstatSync(dirPath);
  if (stat.isDirectory()) {
    fs.rmdirSync(dirPath);
  } else {
    fs.rmdirSync(fs.realpathSync(dirPath));
    fs.unlinkSync(dirPath);
  }
}

function isGitRepo(url: string): boolean {
  return (
    new RegExp(
      '^git@[a-zA-Z0-9._-]+:[a-zA-Z0-9._-]+(/[a-zA-Z0-9._-]+)+.git(@v(0|[1-9]\\d*).(0|[1-9]\\d*).(0|[1-9]\\d*))?$'
    ).test(url) ||
    new RegExp(
      '^http(s)?://([a-zA-Z0-9._-]*?(:[a-zA-Z0-9._-]*)?@)?[a-zA-Z0-9._-]+' +
        '(/[a-zA-Z0-9._-]+)+.git(@v(0|[1-9]\\d*).(0|[1-9]\\d*).(0|[1-9]\\d*))?$'
    ).test(url)
  );
}

async function installNpmPlugin(ctx: any, ...dependencies: string[]) {
  const packageManager = ctx?.config?.packageManager;
  const registryUrl = await getRegistryUrl(packageManager);
  try {
    await Promise.all(
        dependencies.map(async (dependency: string) => {
          try {
            return await packageJson(dependency, registryUrl);
          } catch (err) {
            ctx.logger.error(`${dependency} not found on ${packageManager}, please check if it exists`);
            process.exit(2);
          }
        })
    );
  } catch (e) {
    ctx.logger.error(`get pkg info error ${JSON.stringify(e)}`);
  }

  ctx.logger.info('Installing packages. This might take a couple of minutes.');

  return install(
    packageManager,
    ctx.root,
    packageManager === 'yarn' ? 'add' : 'install',
    dependencies,
    false,
    true
  ).then(() => {
    ctx.logger.info('install success');
  });
}

function updateNpmPluginInfo(ctx: any, pluginName: string, options: any) {
  const {
    root
  }: {
    root: string;
  } = ctx;
  const configPath = path.join(root, NPM_PLUGIN_INFO_JSON);
  const npmPluginInfoJson = fs.existsSync(configPath)
    ? require(configPath)
    : {};
  if (options === false) {
    delete npmPluginInfoJson[pluginName];
  } else {
    if (options.globalCmd) {
      const pluginInfo = npmPluginInfoJson[pluginName] || {};
      const globalCmd = pluginInfo.globalCmd || [];
      pluginInfo.globalCmd = globalCmd
        ? Array.from(
            new Set<string>([...globalCmd, ...options.globalCmd])
          )
        : options.globalCmd || [];
      npmPluginInfoJson[pluginName] = pluginInfo;
      delete options.globalCmd;
    }
    npmPluginInfoJson[pluginName] = Object.assign(
      {},
      npmPluginInfoJson[pluginName] || {},
      options || {}
    );
  }
  fs.writeFileSync(configPath, JSON.stringify(npmPluginInfoJson, null, 4));
}

async function installJsPlugin(ctx: any, installPlugin: string) {
  const {
    bin,
    lib,
    logger
  }: {
    bin: string;
    lib: string;
    logger: any;
  } = ctx;
  const isGlobal = ctx?.args['g'];
  // install js npm plugin
  await installNpmPlugin(ctx, installPlugin);

  // if install with option -g, register as global command
  if (
    isGlobal &&
    /^feflow-plugin-|^@[^/]+\/feflow-plugin-/.test(installPlugin)
  ) {
    ctx.hook.on(HOOK_TYPE_ON_COMMAND_REGISTERED, (cmdName: string) => {
      if (cmdName) {
        logger.debug(
          `linking cmd [${cmdName}] registered by plugin ${installPlugin} to global`
        );
        // create symbol link to plugin, support global plugin cmd
        const linker = new Linker();
        linker.register(bin, lib, cmdName);
        updateNpmPluginInfo(ctx, installPlugin, { globalCmd: [cmdName] });
        logger.info(
          `can just type > "${cmdName} options" in terminal, equal to "fef ${cmdName} options"`
        );
      }
    });
    return applyPlugins([installPlugin])(ctx);
  }
}

async function startInstall(
  ctx: any,
  pkgInfo: PkgInfo,
  repoPath: string,
  updateFlag: boolean,
  isGlobal: boolean
) {
  const {
    logger,
    universalPkg,
    universalModules,
    bin,
    lib
  }: {
    logger: any;
    universalPkg: UniversalPkg;
    universalModules: string;
    bin: string;
    lib: string;
  } = ctx;

  // start install
  logger.debug('install version:', pkgInfo.checkoutTag);
  if (pkgInfo.fromType !== PkgInfo.dir) {
    if (!fs.existsSync(repoPath)) {
      logger.info(`start download from ${pkgInfo.repoFrom}`);
      try {
        await download(pkgInfo.repoFrom, pkgInfo.checkoutTag, repoPath);
      } catch (e) {
        logger.warn(`download warn with code ${e}`);
      }
    }
  } else {
    deleteDir(repoPath);
    logger.info(`start copy from ${pkgInfo.repoFrom}`);
    await copyDir(pkgInfo.repoFrom, repoPath);
  }
  let lastRepoName = '';
  const lastVersion = universalPkg.getInstalled().get(pkgInfo.repoName);
  if (lastVersion) {
    const oldRepoPath = getRepoPath(
      universalModules,
      pkgInfo.repoName,
      lastVersion
    );
    lastRepoName = toSimpleCommand(pkgInfo.repoName);
    try {
      const oldPlugin = resolvePlugin(ctx, oldRepoPath);
      if (oldPlugin.name) {
        lastRepoName = oldPlugin.name;
      }
    } catch (e) {}
  }
  if (pkgInfo.fromType !== PkgInfo.dir) {
    logger.info(`switch to version: ${pkgInfo.checkoutTag}`);
    await checkoutVersion(repoPath, pkgInfo.checkoutTag, pkgInfo.lastCheckoutTag);
  }

  // deal dependencies
  const linker = new Linker();
  const oldVersion = universalPkg.getInstalled().get(pkgInfo.repoName);
  let oldDependencies;
  if (isGlobal && oldVersion) {
    oldDependencies = universalPkg.getDependencies(
      pkgInfo.repoName,
      oldVersion
    );
    if (oldDependencies) {
      oldDependencies = new Map(oldDependencies);
    }
  }

  const plugin = resolvePlugin(ctx, repoPath);
  // check the validity of the plugin before installing it
  await plugin.check();
  logger.debug('check plugin success');

  const pluginBin = path.join(repoPath, `.${FEFLOW_BIN}`);
  const pluginLib = path.join(repoPath, `.${FEFLOW_LIB}`);

  for (const depPlugin of plugin.dep.plugin) {
    try {
      const curPkgInfo = await getPkgInfo(ctx, depPlugin);
      if (!curPkgInfo) {
        throw `the dependent plugin ${depPlugin} does not belong to the universal packge`;
      }
      await installPlugin(ctx, depPlugin, false);
      const commandName = toSimpleCommand(curPkgInfo.repoName);
      if (
        oldDependencies?.get(curPkgInfo.repoName) === curPkgInfo.installVersion
      ) {
        oldDependencies.delete(curPkgInfo.repoName);
      }
      universalPkg.depend(
        pkgInfo.repoName,
        pkgInfo.installVersion,
        curPkgInfo.repoName,
        curPkgInfo.installVersion
      );
      const pluginPath = path.join(universalModules, `${curPkgInfo.repoName}@${curPkgInfo.installVersion}`);
      const curPlugin = resolvePlugin(ctx, pluginPath);
      let useCommandName = commandName;
      // custom command name
      if (curPlugin.name) {
        useCommandName = curPlugin.name;
      }
      if (curPlugin.langRuntime) {
        const commands = curPlugin.command.getCommands();
        linker.registerCustom(pluginBin, pluginLib, commands, useCommandName);
      } else {
        // call {pkg}@{version} and disable-check
        linker.register(
          pluginBin,
          pluginLib,
          `${commandName}@${curPkgInfo.installVersion} --disable-check --slient`,
          useCommandName
        );
      }
      logger.info(
        `install [${curPkgInfo.showName()}] ` +
          `was successful and it is called using [${useCommandName}]`
      );
    } catch (e) {
      logger.error(`failed to install plugin dependency ${depPlugin}`);
      throw e;
    }
  }

  if (oldVersion && oldDependencies) {
    for (const [oldPkg, oldPkgVersion] of oldDependencies) {
      universalPkg.removeDepended(
        oldPkg,
        oldPkgVersion,
        pkgInfo.repoName,
        oldVersion
      );
    }
  }

  plugin.preInstall.run();
  const cmdName = toSimpleCommand(pkgInfo.repoName);
  let useCommandName = cmdName;
  // custom command name
  if (plugin.name) {
    useCommandName = plugin.name;
  }
  if (plugin.langRuntime) {
    const commands = plugin.command.getCommands();
    linker.registerCustom(bin, lib, commands, useCommandName);
  } else {
    linker.register(bin, lib, cmdName, useCommandName);
  }
  if (lastRepoName && lastRepoName !== useCommandName) {
    linker.remove(bin, lib, lastRepoName);
  }
  // install when global or not exists
  if (isGlobal || !universalPkg.isInstalled(pkgInfo.repoName)) {
    universalPkg.install(pkgInfo.repoName, pkgInfo.installVersion);
  }

  // the package management information is retained only when the installation is fully successful
  if (isGlobal) {
    removeInvalidPkg(ctx);
  }

  universalPkg.saveChange();
  plugin.test.runLess();

  if (updateFlag) {
    plugin.postUpgrade.runLess();
    logger.info(
      `update [${pkgInfo.showName()}] ` +
        `was successful and it is called using [${useCommandName}]`
    );
  } else {
    plugin.postInstall.runLess();
    logger.info(
      `install [${pkgInfo.showName()}] ` +
        `was successful and it is called using [${useCommandName}]`
    );
  }
}

function getRepoPath(
  universalModules: string,
  repoName: string,
  installVersion: string
): string {
  return path.join(universalModules, `${repoName}@${installVersion}`);
}

async function installPlugin(
  ctx: any,
  installPluginStr: string,
  isGlobal: boolean
) {
  const {
    logger,
    universalPkg,
    universalModules
  }: {
    logger: any;
    universalPkg: UniversalPkg;
    universalModules: string;
  } = ctx;
  const serverUrl = ctx.config?.serverUrl;

  installPluginStr = installPluginStr.trim();
  if (!serverUrl) {
    logger.warn('please configure the serverUrl');
    return installJsPlugin(ctx, installPluginStr);
  }
  const pkgInfo = await getPkgInfo(ctx, installPluginStr);
  if (!pkgInfo) {
    return installJsPlugin(ctx, installPluginStr);
  }
  if (!pkgInfo.repoName) {
    throw `plugin [${pkgInfo.repoFrom}] does not exist`;
  }
  // if the specified version is already installed, skip it
  if (
    universalPkg.isInstalled(pkgInfo.repoName, pkgInfo.checkoutTag, !isGlobal)
  ) {
    global && logger.info(`the current version is installed`);
    return;
  }
  let updateFlag = false;

  const repoPath = getRepoPath(
    universalModules,
    pkgInfo.repoName,
    pkgInfo.installVersion
  );
  if (pkgInfo.installVersion === LATEST_VERSION) {
    if (universalPkg.isInstalled(pkgInfo.repoName, LATEST_VERSION)) {
      try {
        const currentVersion = await getCurrentTag(repoPath);
        if (currentVersion && pkgInfo.checkoutTag === currentVersion) {
          if (global) {
            logger.info(
              `the plugin version currently installed is the latest version: ${currentVersion}`
            );
          }
          return;
        } else {
          updateFlag = true;
          if (currentVersion) {
            pkgInfo.lastCheckoutTag = currentVersion;
          }
        }
      } catch (e) {
        logger.error(JSON.stringify(e));
      }
    }
  }
  if (updateFlag) {
    logger.info(
      `[${pkgInfo.showName()}] update the plugin to version ${
        pkgInfo.checkoutTag
      }`
    );
    try {
      resolvePlugin(ctx, repoPath).preUpgrade.runLess();
    } catch (e) {}
  } else {
    logger.info(`[${pkgInfo.showName()}] installing plugin`);
  }

  await startInstall(ctx, pkgInfo, repoPath, updateFlag, isGlobal);
}

function toSimpleCommand(command: string): string {
  return command.replace(FEFLOW_PLUGIN_PREFIX, '');
}

function isDir(installPluginDir: string): boolean {
  try {
    return fs.statSync(installPluginDir).isDirectory();
  } catch (e) {
    return false;
  }
}

// when you install a universal package, return PkgInfo, otherwise return undefined
async function getPkgInfo(
  ctx: any,
  installPlugin: string
): Promise<PkgInfo | undefined> {
  let installVersion;
  let checkoutTag;
  let repoFrom;
  let repoName;
  let fromType: number;
  // install from git repo
  if (isGitRepo(installPlugin)) {
    fromType = PkgInfo.git;
    if (installPlugin.indexOf('git@') != -1) {
      const splits = installPlugin.split('@');
      const ver = splits.pop();
      repoFrom = splits.join('@');
      installVersion = ver || LATEST_VERSION;
    } else {
      repoFrom = installPlugin;
      installVersion = LATEST_VERSION;
    }
    const confirmTag =
      installVersion === LATEST_VERSION ? undefined : installVersion;
    checkoutTag = await getTag(repoFrom, confirmTag);
    repoName = getGitRepoName(repoFrom);
  } else if (isDir(installPlugin)) {
    fromType = PkgInfo.dir;
    const plugin = resolvePlugin(ctx, installPlugin);
    if (!plugin.name) {
      throw 'the [name] field must be specified in plugin.yml';
    }
    installVersion = LATEST_VERSION;
    checkoutTag = INVALID_VERSION;
    repoFrom = installPlugin;
    repoName = getDirRepoName(installPlugin);
  } else {
    fromType = PkgInfo.appStore;
    let [pluginName, pluginVersion] = installPlugin.split('@');
    const repoInfo = await getRepoInfo(ctx, pluginName);
    if (!repoInfo) {
      ctx.logger.warn('cant found massage from Feflow Application market, please check if it exists');
      return;
    }
    repoFrom = repoInfo.repo;
    repoName = repoInfo.name;
    if (isGitRepo(repoFrom) && !repoInfo.tnpm) {
      if (pluginVersion) {
        pluginVersion = versionImpl.toFull(pluginVersion);
        if (!versionImpl.check(pluginVersion)) {
          throw `invalid version: ${pluginVersion}`;
        }
      }
      installVersion = pluginVersion || LATEST_VERSION;
      checkoutTag = await getTag(
        repoFrom,
        installVersion === LATEST_VERSION ? undefined : installVersion
      );
    } else {
      return;
    }
  }
  if (!checkoutTag) {
    throw `the version [${installVersion}] was not found`;
  }
  return new PkgInfo(repoName, repoFrom, installVersion, checkoutTag, fromType);
}

class PkgInfo {
  public static git = 1;
  public static appStore = 2;
  public static dir = 3;

  repoName: string;
  repoFrom: string;
  installVersion: string;
  checkoutTag: string;
  lastCheckoutTag = '';
  fromType: number;

  constructor(
    repoName: string,
    repoUrl: string,
    installVersion: string,
    checkoutTag: string,
    fromType: number
  ) {
    this.repoName = repoName;
    this.repoFrom = repoUrl;
    this.installVersion = installVersion;
    this.checkoutTag = checkoutTag;
    this.fromType = fromType;
  }

  public showName(): string {
    if (this.fromType != PkgInfo.appStore) {
      return this.repoFrom;
    }
    return this.repoName;
  }
}

async function uninstallUniversalPlugin(ctx: any, pluginName: string) {
  const {
    logger,
    universalPkg
  }: {
    logger: any;
    universalPkg: UniversalPkg;
    bin: string;
    lib: string;
  } = ctx;
  const version = universalPkg.getInstalled().get(pluginName);
  if (!version) {
    logger.error('this plugin is not currently installed');
    return;
  }
  try {
    const repoPath = path.join(
      ctx.universalModules,
      `${pluginName}@${version}`
    );
    let plugin: Plugin | undefined;
    try {
      plugin = resolvePlugin(ctx, repoPath);
    } catch (e) {
      logger.debug(`resolve plugin failure, ${e}`);
    }
    plugin?.preUninstall?.run();
    universalPkg.uninstall(pluginName, version);
    plugin?.postUninstall?.runLess();
  } catch (e) {
    logger.error(`uninstall failure, ${e}`);
    return;
  }
  try {
    removeInvalidPkg(ctx);
    logger.info('uninstall success');
  } catch (e) {
    logger.info(`uninstall succeeded, but failed to clean the data, ${e}`);
  }
}

async function uninstallNpmPlugin(ctx: any, dependencies: []) {
  const {
    logger,
    root,
    bin,
    lib
  }: {
    logger: any;
    root: string;
    bin: string;
    lib: string;
  } = ctx;
  dependencies.forEach((pkg: string) => {
    const npmPluginInfoPath = path.join(root, NPM_PLUGIN_INFO_JSON);
    try {
      if (fs.existsSync(npmPluginInfoPath)) {
        const npmPluginInfo = require(npmPluginInfoPath);
        const pluginGlobalCmd = npmPluginInfo?.[pkg]?.globalCmd || [];
        pluginGlobalCmd.forEach((cmd: string) => {
          new Linker().remove(bin, lib, cmd);
        });
        updateNpmPluginInfo(ctx, pkg, false);
      }
    } catch (e) {
      logger.debug(`remove plugin registered cmd link failure, ${e}`);
    }
  });
  return install(
    ctx?.config?.packageManager,
    ctx.root,
    ctx?.config?.packageManager === 'yarn' ? 'remove' : 'uninstall',
    dependencies,
    false,
    true
  ).then(() => {
    ctx.logger.info('uninstall success');
  });
}

function removePkg(ctx: any, pkg: string, version: string) {
  const {
    bin,
    lib,
    universalPkg
  }: { universalPkg: UniversalPkg; bin: string; lib: string } = ctx;
  const pluginPath = path.join(ctx.universalModules, `${pkg}@${version}`);
  if (fs.existsSync(pluginPath)) {
    let useName = toSimpleCommand(pkg);
    const curPlugin = resolvePlugin(ctx, pluginPath);
    if (curPlugin.name) {
      useName = curPlugin.name;
    }
    deleteDir(pluginPath);
    if (!universalPkg.isInstalled(pkg)) {
      try {
        new Linker().remove(bin, lib, useName);
      } catch (e) {
        ctx.logger.debug(`remove link failure, ${e}`);
      }
    }
  }
}

function removeInvalidPkg(ctx: any) {
  const { universalPkg }: { universalPkg: UniversalPkg } = ctx;
  const invalidDep = universalPkg.removeInvalidDependencies();
  for (const [invalidPkg, invalidVersion] of invalidDep) {
    removePkg(ctx, invalidPkg, invalidVersion);
  }
}

// update only the plugins installed globally
async function updateUniversalPlugin(
  ctx: any,
  pkg: string,
  version: string,
  plugin: Plugin
) {
  const universalPkg = ctx.universalPkg as UniversalPkg;
  const dependedOn = universalPkg.getDepended(pkg, version);
  // update parent
  if (dependedOn) {
    for (const [dependedOnPkg, dependedOnVersion] of dependedOn) {
      if (dependedOnVersion !== LATEST_VERSION) {
        continue;
      }
      await updatePlugin(ctx, dependedOnPkg, dependedOnVersion);
    }
  }
  const newVersion = universalPkg.getInstalled().get(pkg);
  if (
    newVersion === version &&
    version === LATEST_VERSION &&
    plugin.autoUpdate
  ) {
    await updatePlugin(ctx, pkg, version);
  }
}

async function updatePlugin(ctx: any, pkg: string, version: string) {
  const { universalPkg }: { universalPkg: UniversalPkg } = ctx;
  const isGlobal = universalPkg.isInstalled(pkg, version);
  try {
    await installPlugin(ctx, `${pkg}@${version}`, isGlobal);
  } catch (e) {
    ctx.logger.error(`[${pkg}] update failure, ${e}`);
  }
}

module.exports = (ctx: any) => {
  ctx.commander.register('install', 'Install a devkit or plugin', async () => {
    const dependencies = ctx.args['_'];
    const installPluginStr = dependencies[0];
    if (!installPluginStr) {
      ctx.logger.error('parameter error');
      return;
    }
    try {
      await installPlugin(ctx, installPluginStr, true);
    } catch (e) {
      ctx.logger.error(`install error: ${e}`);
      process.exit(2);
    }
  });

  ctx.commander.register(
    'uninstall',
    'Uninstall a devkit or plugin',
    async () => {
      const dependencies = ctx.args['_'];
      ctx.logger.info(
        'Uninstalling packages. This might take a couple of minutes.'
      );
      const serverUrl = ctx.config?.serverUrl;
      if (!serverUrl) {
        return uninstallNpmPlugin(ctx, dependencies);
      }
      const { universalPkg } = ctx;
      const installPluginStr = dependencies[0];
      const pkgInfo = await getPkgInfo(ctx, installPluginStr);
      if (pkgInfo && universalPkg.isInstalled(pkgInfo.repoName)) {
        return uninstallUniversalPlugin(ctx, pkgInfo.repoName);
      }

      await uninstallNpmPlugin(ctx, dependencies);

      const pickerConfig = new CommandPickConfig(ctx);
      pickerConfig.removeCache(dependencies[0]);
    }
  );
};

module.exports.installPlugin = installPlugin;
module.exports.updateUniversalPlugin = updateUniversalPlugin;
module.exports.getRepoInfo = getRepoInfo;
module.exports.getPkgInfo = getPkgInfo;
