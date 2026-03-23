import type koMessages from '../messages/ko.json'

type Messages = typeof koMessages

declare global {
  // next-intl 메시지 타입 추론: ko.json 구조를 기본 타입으로 사용
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface IntlMessages extends Messages {}
}
