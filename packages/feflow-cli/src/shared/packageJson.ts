import axios, { AxiosResponse } from 'axios';
import semver from 'semver';

export default function packageJson(
  name: string,
  registry: string
): Promise<string> {
  const names = (name || '').split('@');
  const version = !names[0] ? names[2] : names[1];
  const isValidVersion = semver.valid(version) || version === 'latest';
  const url = `${registry}/${
    isValidVersion ? `@${names[1]}/${names[2]}` : name
  }`;
  console.log('pkg url: ', url);
  return axios.get(url)
    .then((response: AxiosResponse) => {
      const { data } = response || { 'dist-tags': {} };
      if (!isValidVersion) {
        const version = data['dist-tags'].latest;
        return version || '';
      } else {
        // 指定包的版本情况
        return data.version || '';
      }
    })
    .catch((err: object) => {
      return err;
    });
}
