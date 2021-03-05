import Commander from './commander';
import Hook from './hook';
import Binp from './universal-pkg/binp';
import fs from 'fs';
import logger from './logger';
import osenv from 'osenv';
import path from 'path';
import spawn from 'cross-spawn';
import loadPlugins from './plugin/loadPlugins';
import loadUniversalPlugin from './plugin/loadUniversalPlugin';
import loadDevkits from './devkit/loadDevkits';
import getCommandLine from './devkit/commandOptions';
import {
  FEFLOW_ROOT,
  FEFLOW_BIN,
  FEFLOW_LIB,
  UNIVERSAL_PKG_JSON,
  UNIVERSAL_MODULES,
  HOOK_TYPE_ON_COMMAND_REGISTERED,
  LOG_FILE
} from '../shared/constant';
import { safeDump, parseYaml } from '../shared/yaml';
import { FefError } from '../shared/fefError';
import { setServerUrl } from '../shared/git';
import chalk from 'chalk';
import commandLineUsage from 'command-line-usage';
import { UniversalPkg } from './universal-pkg/dep/pkg';
import Report from '@feflow/report';
import CommandPicker, {
  LOAD_UNIVERSAL_PLUGIN,
  LOAD_PLUGIN,
  LOAD_DEVKIT,
  LOAD_ALL
} from './command-picker';
import { checkUpdate } from './resident';
import {
  mkdirAsync,
  statAsync,
  unlinkAsync,
  writeFileAsync,
  readFileAsync
} from '../shared/fs';

const pkg = require('../../package.json');

export default class Feflow {
  public args: any;
  public cmd: any;
  public projectConfig: any;
  public projectPath: any;
  public version: string;
  public logger: any;
  public loggerPath: any;
  public commander: any;
  public hook: any;
  public root: any;
  public rootPkg: any;
  public universalPkgPath: string;
  public universalModules: string;
  public config: any;
  public configPath: any;
  public bin: string;
  public lib: string;
  public universalPkg: UniversalPkg;
  public reporter: any;
  public commandPick: CommandPicker | null;
  public fefError: FefError;

  constructor(args: any) {
    args = args || {};
    const root = path.join(osenv.home(), FEFLOW_ROOT);
    const configPath = path.join(root, '.feflowrc.yml');
    this.root = root;
    const bin = path.join(root, FEFLOW_BIN);
    const lib = path.join(root, FEFLOW_LIB);
    this.bin = bin;
    this.lib = lib;
    this.rootPkg = path.join(root, 'package.json');
    this.loggerPath = path.join(root, LOG_FILE);
    this.universalPkgPath = path.join(root, UNIVERSAL_PKG_JSON);
    this.universalModules = path.join(root, UNIVERSAL_MODULES);
    this.args = args;
    this.version = pkg.version;
    this.config = parseYaml(configPath);
    setServerUrl(this.config?.serverUrl);
    this.configPath = configPath;
    this.hook = new Hook();
    this.commander = new Commander((cmdName: string) => {
      this.hook.emit(HOOK_TYPE_ON_COMMAND_REGISTERED, cmdName);
    });
    this.logger = logger({
      debug: Boolean(args.debug),
      silent: Boolean(args.silent)
    });
    this.reporter = new Report(this);
    this.universalPkg = new UniversalPkg(this.universalPkgPath);
    this.commandPick = null;
    this.fefError = new FefError(this);
  }

  async init(cmd: string) {
    this.reporter.init && this.reporter.init(cmd);
    await Promise.all([
      this.initClient(),
      this.initPackageManager(),
      this.initBinPath()
    ]);

    const disableCheck =
      this.args['disable-check'] ||
      String(this.config?.disableCheck) === 'true';

    if (!disableCheck) {
      checkUpdate(this);
    }

    this.commandPick = new CommandPicker(this, cmd);

    try {
      if (this.commandPick.isAvailable()) {
        // should hit the cache in most cases
        this.logger.debug('find cmd in cache');
        this.commandPick.pickCommand();
        await this.loadCommands(LOAD_DEVKIT);
      } else {
        // if not, load plugin/devkit/native in need
        this.logger.debug('this kind of command is not available in cache');
        await this.loadCommands(this.commandPick.getLoadOrder());
        // make sure the command has at least one funtion, otherwise replace to help command
        this.commandPick.checkCommand();
        this.commandPick.updateCache();
      }
    } catch(e) {
      this.logger.debug('command picker got an error:', e);
      await this.loadCommands(this.commandPick.getLoadOrder());
    }

  }

  async initClient() {
    const { rootPkg } = this;

    try {
      await statAsync(rootPkg);
      const pkgInfo = await readFileAsync(rootPkg);
      // 检测package.json为空
      if (!pkgInfo.toString()) {
        await writeFileAsync(
          rootPkg,
          JSON.stringify(
            {
              name: 'feflow-home',
              version: '0.0.0',
              private: true
            },
            null,
            2
          )
        );
      }
    } catch (e) {
      await writeFileAsync(
        rootPkg,
        JSON.stringify(
          {
            name: 'feflow-home',
            version: '0.0.0',
            private: true
          },
          null,
          2
        )
      );
    }
  }

  async initBinPath() {
    const { bin } = this;
    try {
      const stats = await statAsync(bin);
      if (!stats.isDirectory()) {
        await unlinkAsync(bin);
      }
    } catch (e) {
      await mkdirAsync(bin);
    }
    new Binp().register(bin);
  }

  initPackageManager() {
    const { root, logger } = this;

    return new Promise<any>((resolve, reject) => {
      if (!this.config || !this.config.packageManager) {
        const isInstalled = (packageName: string) => {
          try {
            const ret = spawn.sync(packageName, ['-v'], {
              stdio: 'ignore',
              windowsHide: true
            });
            if (ret.status !== 0) {
              return false;
            }
            return true;
          } catch (err) {
            return false;
          }
        };

        const packageManagers = ['tnpm', 'cnpm', 'npm', 'yarn'];

        const installedPackageManagers = packageManagers.filter(
          (packageManager) => isInstalled(packageManager)
        );

        if (installedPackageManagers.length === 0) {
          const notify = 'You must installed a package manager';
          console.error(notify);
        } else {
          const defaultPackageManager = installedPackageManagers[0];
          const configPath = path.join(root, '.feflowrc.yml');
          safeDump(
            {
              packageManager: defaultPackageManager
            },
            configPath
          );
          this.config = parseYaml(configPath);
          resolve();
        }
        return;
      } else {
        logger.debug('Use packageManager is: ', this.config.packageManager);
      }
      resolve();
    });
  }

  loadNative() {
    return new Promise<any>((resolve, reject) => {
      const nativePath = path.join(__dirname, './native');
      fs.readdirSync(nativePath)
        .filter((file) => {
          return file.endsWith('.js');
        })
        .map((file) => {
          require(path.join(__dirname, './native', file))(this);
        });
      resolve();
    });
  }

  async loadCommands(order: number) {
    this.logger.debug('load order: ', order);
    if ((order & LOAD_ALL) === LOAD_ALL) {
      await Promise.all([
        this.loadNative(),
        loadUniversalPlugin(this),
        loadPlugins(this),
        loadDevkits(this)
      ]);
      return;
    }
    if ((order & LOAD_PLUGIN) === LOAD_PLUGIN) {
      await loadPlugins(this);
    }
    if ((order & LOAD_UNIVERSAL_PLUGIN) === LOAD_UNIVERSAL_PLUGIN) {
      await loadUniversalPlugin(this);
    }
    if ((order & LOAD_DEVKIT) === LOAD_DEVKIT) {
      await loadDevkits(this);
    }
  }

  loadInternalPlugins() {
    ['@feflow/feflow-plugin-devtool'].map((name: string) => {
      try {
        this.logger.debug('Plugin loaded: %s', chalk.magenta(name));
        return require(name)(this);
      } catch (err) {
        this.fefError.printError({
          error: err,
          msg: 'internal plugin load failed: %s'
        });
      }
    });
  }

  async call(name: any, ctx: any) {
    const cmd = this.commander.get(name);
    if (cmd) {
      this.logger.name = cmd.pluginName;
      await cmd.call(this, ctx);
    } else {
      this.logger.debug('Command `' + name + '` has not been registered yet!');
    }
  }

  async showCommandOptionDescription(cmd: any, ctx: any): Promise<any> {
    const registriedCommand = ctx.commander.get(cmd);
    let commandLine: object[] = [];

    if (registriedCommand && registriedCommand.options) {
      commandLine = getCommandLine(
        registriedCommand.options,
        registriedCommand.desc,
        cmd
      );
    }

    if (cmd === 'help') {
      registriedCommand.call(this, ctx);
      return true;
    }
    if (commandLine.length == 0) {
      return false;
    }

    const sections = [];

    sections.push(...commandLine);
    const usage = commandLineUsage(sections);

    console.log(usage);
    return true;
  }
}
