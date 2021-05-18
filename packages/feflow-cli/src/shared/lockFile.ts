import fs from 'fs';
import lockFile from 'lockfile';
import logger from '../core/logger';

export default class LockFileInstance {
  private filePath: string;
  private lockKey: string;
  private logger: any;
  private tryMax: number;
  private tryGap: number;
  private tryCount: number;

  constructor(filePath: string, lockKey: string) {
    this.filePath = filePath;
    this.lockKey = lockKey;
    this.logger = logger({
      debug: false,
      silent: true
    });
    this.tryMax = 50;
    this.tryGap = 100;
    this.tryCount = 0;
  }

  clearFile(): void {
    fs.writeFileSync(this.filePath, JSON.stringify({}, null, 2), 'utf-8');
  }

  checkIfCanRead(cb: any): void {
    const status = lockFile.checkSync(this.lockKey);
    if (status) {
      // another writing is runing
      if (this.tryCount >= this.tryMax) {
        this.tryCount = 0;
        throw new Error(`file read time out ${this.filePath}`);
      }
      this.tryCount++;
      setTimeout(() => {
        this.checkIfCanRead(cb);
      }, this.tryGap);
    } else {
      // read immediatelly
      this.tryCount = 0;
      cb && cb();
    }
  }

  read(key: string | undefined): Promise<any> {
    return new Promise(resolve => {
      try {
        fs.stat(
          this.filePath,
          (err: Error | null, stats: { isFile: () => boolean }) => {
            if (err) {
              this.logger.error(err);
              resolve(undefined);
              return;
            }
            if (!stats) {
              this.logger.error('no stats');
              resolve(undefined);
              return;
            }
            if (stats && !stats.isFile()) {
              resolve(undefined);
              return;
            }

            this.checkIfCanRead(() => {
              fs.readFile(
                this.filePath,
                'utf8',
                (err: Error | null, data: string) => {
                  if (err) {
                    this.logger.error(err);
                    resolve(undefined);
                    return;
                  }

                  if (!data) {
                    // no data then turn it to {}
                    this.clearFile();
                    data = '{}';
                  }

                  this.logger.debug(
                    `get file: ${this.filePath} => data: ${data}`
                  );
                  try {
                    const jsonObj: object = JSON.parse(data);
                    if (key && !jsonObj[key]) {
                      this.logger.debug(
                        `get key ${key} form data ${this.filePath} => no value find`
                      );
                      resolve(undefined);
                      return;
                    }
                    resolve(key ? jsonObj[key] : jsonObj);
                  } catch (e) {
                    // 写入的文件数据有问题，清空文件，下次重新写入。
                    this.clearFile();
                    this.logger.error(e);
                    resolve(undefined);
                  }
                }
              );
            });
          }
        );
      } catch (err) {
        this.logger.error(err);
        resolve(undefined);
      }
    });
  }

  lock(cb: any): void {
    lockFile.lock(
      this.lockKey,
      {
        wait: this.tryGap,
        retries: this.tryMax
      },
      err => {
        if (err) {
          this.logger.error(err);
          this.unlock();
          cb && cb(err);
          return;
        }

        cb && cb();
      }
    );
  }

  unlock(): void {
    lockFile.unlock(this.lockKey, er => {
      er && this.logger.error('er', er);
    });
  }

  update(key: string, value: any): Promise<object | undefined> {
    return new Promise(resolve => {
      try {
        if (!fs.existsSync(this.filePath)) {
          // 文件不存在则创建文件后插入
          this.clearFile();
        }
        if (!key || Object.prototype.toString.call(key) !== '[object String]') {
          this.logger.error(`write file ${this.filePath} key not valid ${key}`);
          resolve(undefined);
          return;
        }
        this.lock((err: Error | undefined | null) => {
          if (err) {
            this.unlock();
            resolve(undefined);
            return;
          }

          let data = fs.readFileSync(this.filePath, 'utf-8');
          if (!data) {
            // no data then turn it to {}
            this.clearFile();
            data = '{}';
          }
          try {
            const jsonObj: object = JSON.parse(data);
            this.logger.debug(
              `write file ${this.filePath} key ${key} value ${value}`
            );
            jsonObj[key] = value;
            fs.writeFile(
              this.filePath,
              JSON.stringify(jsonObj, null, 2),
              (err: Error | null) => {
                this.unlock();
                if (err) {
                  this.logger.error(err);
                  resolve(undefined);
                  return;
                }
                resolve(jsonObj);
              }
            );
          } catch (e) {
            // 文件数据有问题，清空文件，下次重新写入。
            this.clearFile();
            this.logger.error(e);
            this.unlock();
            resolve(undefined);
          }
        });
      } catch (err) {
        this.logger.error(err);
        this.unlock();
        resolve(undefined);
      }
    });
  }
}
