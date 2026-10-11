import { englishDataset, englishRecommendedTransformers, RegExpMatcher } from 'obscenity';

const englishMatcher = new RegExpMatcher({ ...englishDataset.build(), ...englishRecommendedTransformers });

const russianPatterns = [
  /(^|[^а-я])(на|по|за|от|вы|до|об|у|раз|рас|с|съ|из|при)?ху(й|е|я|и|ю)/,
  /пизд/,
  /(^|[^а-я])(на|по|за|от|вы|до|у|раз|рас|съ|из|при)?еб(а|у|л|н|и|ы|е|ч)/,
  /бля(д|т|ь|$|[^а-я])/,
  /(^|[^а-я])сук(а|и|е|у|ой|$|[^а-я])/,
  /муд(а|о)(к|з|ч)/,
  /залуп/,
  /пид(о|а)р/,
  /гандон|гондон/,
  /шлюх/,
];

const normalizeRussian = (value: string) =>
  value
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[a-z]/g, (char) => ({ a: 'а', e: 'е', o: 'о', p: 'р', c: 'с', y: 'у', x: 'х' }[char] ?? char))
    .replace(/[^а-я\s]/g, '');

export const isProfane = (name: string) =>
  englishMatcher.hasMatch(name) || russianPatterns.some((pattern) => pattern.test(normalizeRussian(name)));
