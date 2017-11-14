import 'isomorphic-unfetch';

import uniq from 'lodash-es/uniq';

import YveBot from '.';
import { Answer, IRule, IRuleType } from '../types';
import { PauseRuleTypeExecutors, ValidatorError } from './exceptions';
import { DefineModule } from './module';
import * as utils from './utils';

const types: { [name: string]: IRuleType } = {
  Any: {},

  Passive: {},

  PassiveLoop: {},

  String: {
    executors: [{
      transform: async (value: Answer) => String(value),
    }],
  },

  Number: {
    executors: [{
      transform: async (value: Answer) => Number(value),
      validators: [
        {
          number: true,
          warning: 'Invalid number',
        },
      ],
    }],
  },

  SingleChoice: {
    executors: [{
      transform: async (value: Answer | Answer[], rule: IRule) => {
        const option = utils.findOptionByAnswer(rule.options, value);
        if (!option) {
          return undefined;
        }
        return option.value || option.label;
      },
      validators: [
        {
          function: (answer: Answer | Answer[], rule: IRule) =>
            !!utils.findOptionByAnswer(rule.options, answer),
          warning: 'Unknown option',
        },
      ],
    }],
  },

  MultipleChoice: {
    executors: [{
      transform: async (answer: Answer | Answer[], rule: IRule) => {
        let values;
        if (answer instanceof Array) {
          values = answer;
        } else {
          let options = [];
          rule.options.forEach((o) => {
            options.push(String(o.value || o.label));
            if (o.synonyms) {
              options = options.concat(o.synonyms);
            }
          });
          values = utils.identifyAnswersInString(String(answer), options);
        }
        return uniq(values
          .map((value) => {
            const option = utils.findOptionByAnswer(rule.options, value);
            if (!option) {
              return undefined;
            }
            return option.value || option.label;
          })
          .filter((x) => x));
      },
      validators: [
        {
          function: (answer: Answer | Answer[], rule: IRule) => {
            const answers = utils.ensureArray(answer);
            const options = rule.options.map((o) => String(o.value || o.label));
            return answers.every((a) => options.some((o) => utils.isMatchAnswer(a, o)));
          },
          warning: 'Unknown options',
        },
      ],
    }],
  },

  StringSearch: {
    executors: [
      {}, // necessary to read user's input and apply Rule's validators to it
      {
        transform: async (answer: Answer, rule: IRule, bot: YveBot) => {
          /*
           * Server MUST return a JSON with a list of objects following the format:
           * [
           *   { label: String, value: Any }
           * ]
           * Or you will need to set rule.config.translate object with your
           * server response's objects properties to this expected format
           * - translate:
           *   - label: myProperty1
           *   - value: myProperty2
           */
          const { apiURI, apiQueryParam, translate, messages } = rule.config;
          const searchURI = `${apiURI}?${apiQueryParam}=${encodeURIComponent(String(answer))}`;

          bot.dispatch('typing');
          return fetch(searchURI)
            .then((res) => res.json())
            .then((list) => {
              if (list.length === 0) {
                throw new ValidatorError(messages.noResults, rule);
              }
              return list;
            })
            .then((list) => {
              if (!translate) {
                return list;
              }
              const { label, value } = translate;
              return list.map((obj) => ({ label: obj[label], value: obj[value] }));
            });
        },
      },
      {
        transform: async (results: any, rule: IRule, bot: YveBot) => {
          const { messages } = rule.config;
          let options;
          let message;
          if (results.length === 1) {
            message = `${messages.didYouMean}: ${results[0].label}?`;
            options = [
              { label: messages.yes, value: results[0].value },
              { label: messages.no, value: null },
            ];
          } else {
            message = `${messages.multipleResults}:`;
            options = results.concat([{
              label: messages.noneOfAbove,
              value: null,
            }]);
          }

          bot.talk(message, { type: 'SingleChoice', options });
          throw new PauseRuleTypeExecutors(rule.name);
        },
      },
      {
        validators: [{
          function: (answer: any, rule: IRule, bot: YveBot) => {
            const { messages } = rule.config;
            if (!answer) {
              bot.store.unset(`executors.${rule.name}.currentIdx`);
              bot.talk(messages.wrongResult);
              throw new PauseRuleTypeExecutors(rule.name);
            }
            return true;
          },
        }],
      },
    ],
  },
};

export class Types extends DefineModule {
  public Any: IRuleType;
  public Passive: IRuleType;
  public PassiveLoop: IRuleType;
  public String: IRuleType;
  public Number: IRuleType;
  public SingleChoice: IRuleType;
  public MultipleChoice: IRuleType;
  public StringSearch: IRuleType;

  constructor() {
    super();
    this.define(types);
  }
}
