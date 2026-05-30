import * as gulp from 'gulp';
import terser from 'gulp-terser';
import webpack from 'webpack-stream';
import run from 'gulp-run-command';
import * as prettier from 'prettier';
import * as through2 from 'through2';
import File from 'vinyl';
import concat from 'gulp-concat';
import cleanCSS from 'gulp-clean-css';
import { config } from './src/server/environment/config/config';
import path from 'path';

type FileType = 'typescript' | 'css' | 'html';

const del = require('del');
const vinylPaths = require('vinyl-paths');

interface GulpConfig {
	serverPort: number;
	serverAddress: string;
}

interface Paths {
	src: string;
	clientSrc: string;
	clientBuild: string;
	build: string;
	resources: string;
	htmlSrc: string;
	adminClientSrc: string;
	admin: string;
	private: string;
	privateSrc: string;
}

const gulpConfig: GulpConfig = {
	serverPort: config.serverPort,
	serverAddress: 'http://localhost'
};

const paths: Paths = {
    src: './',
	clientSrc: 'src/client/',
	clientBuild: 'dist/public/',
    build: 'dist/',
	resources: 'resources/',
	htmlSrc: 'templates/',
	adminClientSrc: 'src/admin-client/',
	admin: 'dist/public/admin/',
	private: 'dist/private/',
	privateSrc: 'private-resources/',
};

function compileClientBundle() {
    return gulp
        .src(`${paths.clientSrc}/**/*.ts`, { sourcemaps: true })
        .pipe(webpack(require('./webpack.config.js')))
        .pipe(gulp.dest(paths.clientBuild))
        .pipe(through2.obj(function(file, enc, cb) {
            // After webpack finishes, trigger terser on the generated bundle ONLY
            if (file.path.endsWith('.js') && !file.path.endsWith('.map')) {
                gulp.src(file.path)
                    .pipe(terser())
                    .pipe(gulp.dest(path.dirname(file.path)))
                    .on('end', cb);
            } else {
                cb(null, file);
            }
        }));
}


function compileClientProductionBundle() {
    return gulp
        .src(`${paths.clientSrc}/**/*.ts`, { sourcemaps: true })
        .pipe(webpack(require('./webpack.config.deploy.js')))
        .pipe(gulp.dest(paths.clientBuild))
        .pipe(through2.obj(function(file, enc, cb) {
            if (file.path.endsWith('.js') && !file.path.endsWith('.map')) {
                gulp.src(file.path)
                    .pipe(terser())
                    .pipe(gulp.dest(path.dirname(file.path)))
                    .on('end', cb);
            } else {
                cb(null, file);
            }
        }));
}

function bundleCSS() {
	return gulp
	  .src(`${paths.clientSrc}styles/**/*.css`, { sourcemaps: true })
	  .pipe(concat('main.min.css'))
	  .pipe(cleanCSS({compatibility: 'ie8'}))
	  .pipe(gulp.dest(`${paths.clientBuild}css/`));
  }

  function bundleAdminCSS() {
	return gulp
	  .src(`${paths.adminClientSrc}styles/**/*.css`, { sourcemaps: true })
	  .pipe(concat('main.min.css'))
	  .pipe(cleanCSS({compatibility: 'ie8'}))
	  .pipe(gulp.dest(`${paths.admin}css/`));
  }

function prettierify(fileType: FileType, source: string, target: string) {
	return new Promise<void>((resolve, reject) => {
	  gulp
		.src(source, { sourcemaps: true })
		.pipe(
		  through2.obj(async (file: File, _, callback) => {
			try {
			  const check = await prettier.check(file.contents!.toString('utf8'), {
				parser: fileType,
				semi: true
			  });
  
			  if (!check) {
				// If errors found, format the file and save it back
				const formattedCode = await prettier.format(file.contents!.toString('utf8'), {
				  parser: fileType,
				  semi: true
				});
				file.contents = Buffer.from(formattedCode);
			  }
  
			  // Continue processing the file
			  callback(null, file);
			} catch (error) {
			  // Handle errors during formatting or checking
			  reject(error);
			}
		  })
		)
		.on('error', (error) => {
		  console.error('Error:', error);
		  reject(error);
		})
		.on('end', () => {
		  console.log('Prettification complete');
		  resolve();
		})
		.pipe(gulp.dest(target));
	});
  }

  gulp.task('prettier-ts', async () => {
	return await prettierify('typescript', `${paths.clientSrc}**/*.ts`, paths.clientSrc);
  });

  gulp.task('prettier-css', async () => {
	return await prettierify('css', `${paths.clientSrc}styles/**/*.css`, `${paths.clientSrc}styles/`);
  });

  gulp.task('prettier-html', async () => {
	return await prettierify('html', `${paths.htmlSrc}**/*.html`, paths.htmlSrc);
  });

gulp.task('clean', () => {
    return gulp.src(`${paths.clientBuild}*`)
        .pipe(vinylPaths(del.sync));
});

gulp.task('compile-ts', () => {
	return compileClientBundle();
});



gulp.task('compile-ts-production', () => {
	return compileClientProductionBundle();
});

gulp.task('copy-resources', function () {
	return gulp.src([
		`${paths.resources}/images/**/*.png`,
		`${paths.resources}/images/**/*.jpg`,
		`${paths.resources}/images/**/*.gif`,
		`${paths.resources}/**/*.key`,
		`${paths.resources}/**/*.crt`,
		`${paths.resources}/**/*.pem`,
		`${paths.resources}/**/*.mp3`


	],{
	"base" : paths.src,
	"encoding": false
	})
	.pipe(gulp.dest(paths.clientBuild));
});

gulp.task('copy-private-resources', function () {
	return gulp.src([
		`${paths.privateSrc}/images/**/*.png`,
		`${paths.privateSrc}/images/**/*.jpg`

	],{
	"base" : paths.src,
	"encoding": false
	})
	.pipe(gulp.dest(paths.private));
});

gulp.task('copy-html', function () {
    return gulp.src([
	`${paths.htmlSrc}**/*.html`,
	`${paths.htmlSrc}**/*.txt`, // include robots.txt
	])
        .pipe(gulp.dest(paths.clientBuild));
});

gulp.task('bundle-css', function () {
    return bundleCSS();
});

gulp.task('bundle-admin-css', function () {
    return bundleAdminCSS();
});

gulp.task('watch-scripts', () => {
	gulp.watch(`${paths.clientSrc}**/*.ts`, gulp.series('compile-ts', 'reload'));
	gulp.watch(`${paths.clientSrc}styles/**/*.css`, gulp.series('bundle-css', 'reload'));
	gulp.watch(`${paths.htmlSrc}**/*.html`, gulp.series('copy-html', 'reload'));
	gulp.watch(`${paths.resources}**/*.png`, gulp.series('copy-resources', 'reload'));
});

gulp.task('prettier', gulp.series('prettier-ts', 'prettier-css', 'prettier-html'));

gulp.task('run-server', async () => {
	await run('npx tsc -p tsconfig.server.json')();
	run('node dist/networkhack.js')();
});

gulp.task('deploy-server-really', async () => {
	await run('npx tsc -p tsconfig.server-deploy.json')();
});

gulp.task('default', gulp.series('clean','compile-ts', 'copy-resources', 'copy-private-resources', 'prettier-html', 'copy-html','bundle-css'));
gulp.task('client', gulp.series('clean','compile-ts', 'copy-resources', 'copy-private-resources', 'prettier-html', 'copy-html','bundle-css'));

gulp.task('server', gulp.series('run-server'));

gulp.task('deploy-server', gulp.series('compile-ts-production', 'copy-resources', 'prettier-html', 'copy-resources', 'copy-html','bundle-css', 'deploy-server-really'));
