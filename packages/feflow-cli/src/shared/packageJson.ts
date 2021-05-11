import rp from 'request-promise';
import semver from 'semver';

export default function packageJson(
  name: string,
  registry: string
): Promise<string> {
  const names = (name || '').split('@');
  const isValidVersion = semver.valid(names[names.length - 1]);
  return new Promise((resolve, reject) => {
    const options = {
      url: `${registry}/${
        isValidVersion ? name.replace(/(.*)@/, '$1/') : name
      }`,
      method: 'GET'
    };

    rp(options)
      .then((response: any) => {
        const data = JSON.parse(response);
        if (!isValidVersion) {
          const version = data['dist-tags'].latest;
          resolve(version);
        } else {
          // 指定包的版本情况
          resolve(data['version']);
        }
      })
      .catch((err: object) => {
        reject(err);
      });
  });
}
