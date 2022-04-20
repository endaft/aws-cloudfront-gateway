import * as path from 'path';
import * as webpack from 'webpack';
import ForkTsCheckerWebpackPlugin from 'fork-ts-checker-webpack-plugin';

const config: webpack.Configuration = {
  mode: 'production',
  entry: './src/index.ts',
  resolve: {
    extensions: ['.js', '.jsx', '.json', '.ts', '.tsx'],
  },
  externals: [{ "aws-sdk": "commonjs aws-sdk" }],
  cache: {
    type: 'filesystem',
    cacheDirectory: path.resolve(__dirname, '.webpack'),
    buildDependencies: {
      config: [__filename],
    },
  },
  output: {
    libraryTarget: 'commonjs',
    path: path.join(__dirname, 'dist'),
    filename: 'index.js',
  },
  target: 'node',
  module: {
    rules: [
      {
        // Include ts, tsx, js, and jsx files.
        test: /\.[tj]sx?$/,
        exclude: /node_modules/,
        use: ['ts-loader'],
      },
    ],
  },
  plugins: [new ForkTsCheckerWebpackPlugin()],
};
export default config;
