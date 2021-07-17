import path from 'path';
import fs from 'fs';
import spawn from 'cross-spawn';
import { getRegistryUrl } from '../../shared/npm';
import packageJson from '../../shared/packageJson';
import semver from 'semver';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { safeDump } from '../../shared/yaml';

const { installPlugin, getPkgInfo } = require('./install');

async function updateCli(packageManager: string) {
  return new Promise((resolve, reject) => {
    const args =
      packageManager === 'yarn'
        ? ['global', 'add', '@feflow/cli@latest', '--extract']
        : [
            'install',
            '@feflow/cli@latest',
            '--color=always',
            '--save',
            '--save-exact',
            '--loglevel',
            'error',
            '-g'
          ];

    const child = spawn(packageManager, args, {
      stdio: 'inherit',
      windowsHide: true
    });
    child.on('close', code => {
      if (code !== 0) {
        reject({
          command: `${packageManager} ${args.join(' ')}`
        });
        return;
      }
      resolve();
    });
  });
}

async function checkCliUpdate(ctx: any) {
  const { version, config, configPath } = ctx;
  const packageManager = config.packageManager;
  const registryUrl = await getRegistryUrl(packageManager);
  const latestVersion: any = await packageJson(
    '@feflow/cli',
    registryUrl
  ).catch(() => {
    ctx.logger.warn(
      `Network error, can't reach ${registryUrl}, CLI give up verison check.`
    );
  });

  if (latestVersion && semver.gt(latestVersion, version)) {
    const askIfUpdateCli = [
      {
        type: 'confirm',
        name: 'ifUpdate',
        message: `${chalk.yellow(
          `@feflow/cli's latest version is ${chalk.green(
            `${latestVersion}`
          )}, but your version is ${chalk.red(
            `${version}`
          )}, Do you want to update it?`
        )}`,
        default: true
      }
    ];
    const answer = await inquirer.prompt(askIfUpdateCli);
    if (answer.ifUpdate) {
      await updateCli(packageManager);
    } else {
      safeDump(
        {
          ...config,
          lastUpdateCheck: +new Date()
        },
        configPath
      );
    }
  } else {
    ctx.logger.info(`Current version is already latest.`);
  }
}

module.exports = (ctx: any) => {
  ctx.commander.register('upgrade', 'upgrade fef cli', async () => {
    const dependencies = ctx.args['_'];
    const npmPluginInfoPath = path.join(ctx.root, 'package.json');
    const npmPluginInfoJson = fs.existsSync(npmPluginInfoPath)
      ? require(npmPluginInfoPath)
      : {};
    if (dependencies.length) {
      try {
        // eslint-disable-next-line
        for (const installPluginStr of dependencies) {
          // 判断是 universalPkg 且已安装
          const pkgInfo = await getPkgInfo(ctx, installPluginStr);
          const { universalPkg } = ctx;
          if (pkgInfo && universalPkg.isInstalled(pkgInfo.repoName)) {
            await installPlugin(ctx, installPluginStr, true);
            continue;
          }

          // 判断是 npmPlugin 且已安装
          const splits = installPluginStr.split('@');
          let [pluginName] = splits;
          if (splits.length === 3) {
            splits.pop();
            pluginName = splits.join('@');
          } else if (splits.length === 2) {
            pluginName = installPluginStr;
          }
          if (npmPluginInfoJson?.dependencies?.[pluginName]) {
            await installPlugin(ctx, installPluginStr, true);
            continue;
          }

          ctx.logger.warn(
            `${installPluginStr} is not installed, you need to install it before upgrade`
          );
        }
      } catch (e) {
        ctx.logger.error(`install error: ${e}`);
        process.exit(2);
      }
    } else {
      // 没有参数则更新 cli
      checkCliUpdate(ctx);
    }
  });
};

module.exports.updateCli = updateCli;
module.exports.checkCliUpdate = checkCliUpdate;
