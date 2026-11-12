// @flow
import React from "react";

type Props = { onLogin: (email: string) => void };

export default class Login extends React.Component<Props> {
  handleChange = (event: SyntheticEvent<>) => {};

  render() {
    return null;
  }
}

export const Anonymous = class {};
