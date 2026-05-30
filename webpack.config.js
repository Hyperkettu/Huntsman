const path = require('path');

module.exports = {
    entry: './src/client/main.ts',
    mode: 'development',
    output: {
      path: path.resolve(__dirname, 'dist/public'),
      filename: 'bundle.js',
      libraryTarget: 'var',
      library: 'main'
    },
    resolve: {
      extensions: ['.ts', '.js', '.mjs'],
      alias: {
        'three': path.resolve('./node_modules/three')
      }
    },
    module: {
      rules: [
        {
          test: /\.ts$/,
          exclude: /node_modules/,
          use: [
            {
              loader: 'ts-loader',
              options: {
                transpileOnly: true // Faster and avoids some type issues with large libraries
              }
            }
          ],
        },
        {
          test: /\.(js|mjs)$/,
          // Transpile three.js because it uses modern JS features that Webpack 4 doesn't support natively
          include: [
            path.resolve(__dirname, 'src'),
            path.resolve(__dirname, 'node_modules/three')
          ],
          use: {
            loader: 'babel-loader',
            options: {
              presets: [
                ['@babel/preset-env', {
                  targets: "> 0.25%, not dead",
                  useBuiltIns: "usage",
                  corejs: 3
                }]
              ],
            },
          },
        },
      ],
    },
  };